import { Prisma } from "@prisma/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

const ZERO = new Prisma.Decimal(0);

export type CreditNoteStatus = "DRAFT" | "ISSUED" | "APPLIED" | "EXPIRED";

export interface CreditNoteLineInput {
  lineNumber: number;
  description: string;
  accountId: string;
  quantity: number | string;
  unitPrice: number | string;
}

export interface CreateCreditNoteInput {
  customerId: string;
  issueDate: Date;
  currency: string;
  reason?: string;
  memo?: string;
  lines: CreditNoteLineInput[];
}

export interface CreditNoteSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly creditNoteNumber: number | null;
  readonly issueDate: Date;
  readonly currency: string;
  readonly totalAmount: string;
  readonly remainingAmount: string;
  readonly reason: string | null;
  readonly status: CreditNoteStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function calcCreditNoteTotal(
  lines: CreditNoteLineInput[],
): Prisma.Decimal {
  return lines.reduce(
    (sum, line) =>
      sum.add(new Prisma.Decimal(line.quantity).mul(new Prisma.Decimal(line.unitPrice))),
    ZERO,
  );
}

async function nextCreditNoteNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<
    Array<{ next_number: number }>
  >`
    WITH upsert AS (
      INSERT INTO sales_credit_note_counters (organization_id, last_number)
      VALUES (${organizationId}::uuid, 1)
      ON CONFLICT (organization_id) DO UPDATE
        SET last_number = sales_credit_note_counters.last_number + 1
    )
    SELECT last_number AS next_number
    FROM sales_credit_note_counters
    WHERE organization_id = ${organizationId}::uuid
  `;
  return rows[0]?.next_number ?? 1;
}

export async function createCreditNote(
  scope: LedgerScope,
  input: CreateCreditNoteInput,
): Promise<CreditNoteSummary> {
  return withTx(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (customer === null) {
      throw new NotFoundError(`customer ${input.customerId} not found`);
    }

    const totalAmount = calcCreditNoteTotal(input.lines);

    const creditNoteNumber = await nextCreditNoteNumber(
      tx,
      scope.organizationId,
    );

    const creditNote = await tx.creditNote.create({
      data: {
        organizationId: scope.organizationId,
        customerId: input.customerId,
        creditNoteNumber,
        issueDate: input.issueDate,
        currency: input.currency,
        totalAmount,
        remainingAmount: totalAmount,
        reason: input.reason ?? null,
        memo: input.memo ?? null,
        status: "DRAFT",
      },
    });

    await tx.creditNoteLine.createMany({
      data: input.lines.map((line) => ({
        organizationId: scope.organizationId,
        creditNoteId: creditNote.id,
        lineNumber: line.lineNumber,
        description: line.description,
        accountId: line.accountId,
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        lineTotal: new Prisma.Decimal(line.quantity).mul(new Prisma.Decimal(line.unitPrice)),
      })),
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.creditNote.create",
        entityType: "CreditNote",
        entityId: creditNote.id,
        after: {
          creditNoteNumber,
          totalAmount: totalAmount.toString(),
          status: "DRAFT",
        },
      },
    });

    return toSummary(creditNote);
  });
}

export async function issueCreditNote(
  scope: LedgerScope,
  creditNoteId: string,
): Promise<void> {
  return withTx(async (tx) => {
    const cn = await tx.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: scope.organizationId },
      include: { creditNoteLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (cn === null) {
      throw new NotFoundError(`credit note ${creditNoteId} not found`);
    }
    if (cn.status !== "DRAFT") {
      throw new Error(
        `credit note ${creditNoteId} is ${cn.status}, not DRAFT`,
      );
    }

    // Find AR account.
    const arAccount = await tx.account.findFirst({
      where: {
        organizationId: scope.organizationId,
        code: "1200",
      },
      select: { id: true },
    });
    if (arAccount === null) {
      throw new NotFoundError("Accounts Receivable account (code 1200) not found");
    }

    // Find the period.
    const period = await tx.period.findFirst({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: cn.issueDate },
        endDate: { gte: cn.issueDate },
      },
      select: { id: true, status: true },
    });
    if (period === null) {
      throw new NotFoundError(
        `no accounting period covers ${cn.issueDate.toISOString().slice(0, 10)}`,
      );
    }
    if (period.status !== "OPEN") {
      throw new Error(`cannot post into period ${period.id}: status is ${period.status}`);
    }

    // Build journal lines:
    // Dr Income reversal (per line)
    // Cr A/R (total)
    const lines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      memo: string | null;
    }> = cn.creditNoteLines.map((line) => ({
      accountId: line.accountId,
      debit: line.lineTotal,
      credit: ZERO,
      memo: `Credit note reversal line ${line.lineNumber}: ${line.description}`,
    }));
    lines.push({
      accountId: arAccount.id,
      debit: ZERO,
      credit: cn.totalAmount,
      memo: `Credit note ${cn.creditNoteNumber} — A/R credit`,
    });

    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId: period.id,
        entryDate: cn.issueDate,
        description: `Credit note ${cn.creditNoteNumber} issued`,
        currency: cn.currency,
        sourceModule: "sales",
        sourceId: creditNoteId,
      },
    });

    await tx.journalLine.createMany({
      data: lines.map((line, idx) => ({
        organizationId: scope.organizationId,
        journalEntryId: journalEntry.id,
        accountId: line.accountId,
        lineNumber: idx + 1,
        debit: line.debit,
        credit: line.credit,
        currency: cn.currency,
        fxRate: new Prisma.Decimal(1),
        reportingAmount: new Prisma.Decimal(
          line.debit.add(line.credit).toFixed(4, 1),
        ),
        memo: line.memo,
      })),
    });

    await tx.journalEntry.update({
      where: { id: journalEntry.id },
      data: {
        postedAt: new Date(),
        postedBy: scope.userId,
      },
    });

    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: { status: "ISSUED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.creditNote.issue",
        entityType: "CreditNote",
        entityId: creditNoteId,
        after: { creditNoteNumber: cn.creditNoteNumber, status: "ISSUED" },
      },
    });
  });
}

export async function applyCreditNote(
  scope: LedgerScope,
  creditNoteId: string,
  invoiceId: string,
  amount: number | string,
): Promise<void> {
  return withTx(async (tx) => {
    const cn = await tx.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: scope.organizationId },
    });
    if (cn === null) {
      throw new NotFoundError(`credit note ${creditNoteId} not found`);
    }
    if (cn.status !== "ISSUED") {
      throw new Error(`credit note ${creditNoteId} is ${cn.status}, not ISSUED`);
    }

    const inv = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId },
      select: {
        status: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
        customerId: true,
      },
    });
    if (inv === null) {
      throw new NotFoundError(`invoice ${invoiceId} not found`);
    }
    if (inv.status === "PAID" || inv.status === "CANCELLED") {
      throw new Error(`invoice ${invoiceId} is ${inv.status}, cannot apply credit`);
    }

    const appliedAmount = new Prisma.Decimal(amount);
    if (appliedAmount.greaterThan(cn.remainingAmount)) {
      throw new Error(
        `credit amount ${appliedAmount.toString()} exceeds remaining ${cn.remainingAmount.toString()}`,
      );
    }
    if (appliedAmount.greaterThan(inv.amountDue)) {
      throw new Error(
        `credit amount ${appliedAmount.toString()} exceeds invoice amount due ${inv.amountDue.toString()}`,
      );
    }

    const newRemaining = cn.remainingAmount.sub(appliedAmount);
    const newPaid = new Prisma.Decimal(inv.amountPaid).add(appliedAmount);
    const newDue = new Prisma.Decimal(inv.totalAmount).sub(newPaid);
    let newStatus: string = cn.status;
    if (newRemaining.lte(ZERO)) {
      newStatus = "APPLIED";
    }

    // Update credit note.
    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: { remainingAmount: newRemaining, status: newStatus as CreditNoteStatus },
    });

    // Update invoice.
    let invNewStatus: string = inv.status;
    if (newPaid.greaterThanOrEqual(new Prisma.Decimal(inv.totalAmount))) {
      invNewStatus = "PAID";
    } else if (newPaid.greaterThan(ZERO)) {
      invNewStatus = "PARTIAL";
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: newPaid, amountDue: newDue, status: invNewStatus as any },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.creditNote.apply",
        entityType: "CreditNote",
        entityId: creditNoteId,
        after: { invoiceId, applied: appliedAmount.toString() },
      },
    });
  });
}

export async function expireCreditNote(
  scope: LedgerScope,
  creditNoteId: string,
): Promise<void> {
  return withTx(async (tx) => {
    const cn = await tx.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: scope.organizationId },
    });
    if (cn === null) {
      throw new NotFoundError(`credit note ${creditNoteId} not found`);
    }
    if (cn.status === "APPLIED" || cn.status === "EXPIRED") {
      throw new Error(`credit note ${creditNoteId} is ${cn.status}`);
    }

    // If already issued, reverse the A/R credit (Dr A/R, Cr Income reversal).
    if (cn.status === "ISSUED") {
      const arAccount = await tx.account.findFirst({
        where: {
          organizationId: scope.organizationId,
          code: "1200",
        },
        select: { id: true },
      });

      const lines: Array<{
        accountId: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }> = cn.creditNoteLines.map((line) => ({
        accountId: line.accountId,
        debit: ZERO,
        credit: line.lineTotal,
      }));
      if (arAccount) {
        lines.push({
          accountId: arAccount.id,
          debit: cn.totalAmount,
          credit: ZERO,
        });
      }

      const period = await tx.period.findFirst({
        where: {
          organizationId: scope.organizationId,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
        select: { id: true, status: true },
      });

      if (period !== null && period.status === "OPEN" && lines.length > 0) {
        const reversalEntry = await tx.journalEntry.create({
          data: {
            organizationId: scope.organizationId,
            periodId: period.id,
            entryDate: new Date(),
            description: `Expiry of credit note ${cn.creditNoteNumber}`,
            currency: cn.currency,
            sourceModule: "sales",
            sourceId: creditNoteId,
          },
        });

        await tx.journalLine.createMany({
          data: lines.map((line, idx) => ({
            organizationId: scope.organizationId,
            journalEntryId: reversalEntry.id,
            accountId: line.accountId,
            lineNumber: idx + 1,
            debit: line.debit,
            credit: line.credit,
            currency: cn.currency,
            fxRate: new Prisma.Decimal(1),
            reportingAmount: new Prisma.Decimal(
              line.debit.add(line.credit).toFixed(4, 1),
            ),
          })),
        });

        await tx.journalEntry.update({
          where: { id: reversalEntry.id },
          data: {
            postedAt: new Date(),
            postedBy: scope.userId,
          },
        });
      }
    }

    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: { status: "EXPIRED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.creditNote.expire",
        entityType: "CreditNote",
        entityId: creditNoteId,
        after: { status: "EXPIRED" },
      },
    });
  });
}

function toSummary(cn: {
  id: string;
  organizationId: string;
  customerId: string;
  creditNoteNumber: number | null;
  issueDate: Date;
  currency: string;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  reason: string | null;
  status: CreditNoteStatus;
  createdAt: Date;
  updatedAt: Date;
}): CreditNoteSummary {
  return {
    id: cn.id,
    organizationId: cn.organizationId,
    customerId: cn.customerId,
    creditNoteNumber: cn.creditNoteNumber,
    issueDate: cn.issueDate,
    currency: cn.currency,
    totalAmount: cn.totalAmount.toString(),
    remainingAmount: cn.remainingAmount.toString(),
    reason: cn.reason,
    status: cn.status,
    createdAt: cn.createdAt,
    updatedAt: cn.updatedAt,
  };
}

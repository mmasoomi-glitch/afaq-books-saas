import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError, UnbalancedEntryError } from "../ledger/errors";
import { nextJournalNumber, reportingAmount } from "./posting-helpers";

const ZERO = new Prisma.Decimal(0);

function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

export interface BillLineInput {
  lineNumber: number;
  description: string;
  accountId: string;
  quantity: string | number;
  unitPrice: string | number;
  taxRate?: string | number;
}

export interface CreateBillInput {
  supplierId: string;
  billNumber?: number;
  billDate: Date;
  dueDate: Date;
  currency?: string;
  exchangeRate?: string | number;
  memo?: string;
  notes?: string;
  lines: BillLineInput[];
}

export interface UpdateBillInput {
  billDate?: Date;
  dueDate?: Date;
  memo?: string;
  notes?: string;
}

export interface BillFilter {
  status?: string;
  supplierId?: string;
  from?: Date;
  to?: Date;
}

function computeTotals(lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal; taxAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }[]) {
  const subtotal = lines.reduce((sum, l) => sum.add(l.lineTotal), ZERO);
  const taxAmount = lines.reduce((sum, l) => sum.add(l.taxAmount), ZERO);
  const totalAmount = subtotal.add(taxAmount);
  return { subtotal, taxAmount, totalAmount };
}

export async function createBill(
  scope: LedgerScope,
  input: CreateBillInput,
): Promise<Bill> {
  return withTx(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (supplier === null) {
      throw new NotFoundError(`supplier ${input.supplierId} not found`);
    }

    const lineData: Array<{
      lineNumber: number;
      description: string;
      accountId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }> = [];

    for (const lineInput of input.lines) {
      const quantity = dec(lineInput.quantity);
      const unitPrice = dec(lineInput.unitPrice);
      const taxRate = dec(lineInput.taxRate);
      const lineTotal = quantity.mul(unitPrice);
      const taxAmount = lineTotal.mul(taxRate);

      lineData.push({
        lineNumber: lineInput.lineNumber,
        description: lineInput.description,
        accountId: lineInput.accountId,
        quantity,
        unitPrice,
        taxRate,
        taxAmount,
        lineTotal,
      });
    }

    const totals = computeTotals(lineData);
    const currency = input.currency ?? "USD";
    const exchangeRate = input.exchangeRate ?? 1;

    const bill = await tx.bill.create({
      data: {
        organizationId: scope.organizationId,
        supplierId: input.supplierId,
        billNumber: input.billNumber ?? null,
        billDate: input.billDate,
        dueDate: input.dueDate,
        currency,
        exchangeRate: new Prisma.Decimal(exchangeRate),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        amountPaid: new Prisma.Decimal(0),
        amountDue: totals.totalAmount,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
        status: "DRAFT",
        billLines: {
          create: lineData.map((l) => ({
            lineNumber: l.lineNumber,
            description: l.description,
            accountId: l.accountId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.bill.create",
        entityType: "Bill",
        entityId: bill.id,
        after: {
          billNumber: bill.billNumber,
          supplierId: bill.supplierId,
          totalAmount: bill.totalAmount.toString(),
          status: bill.status,
        },
      },
    });

    return bill;
  });
}

export async function getBill(
  scope: LedgerScope,
  billId: string,
): Promise<Bill & { billLines: unknown[] } | null> {
  return prisma.bill.findFirst({
    where: { id: billId, organizationId: scope.organizationId },
    include: { billLines: { orderBy: { lineNumber: "asc" } } },
  });
}

export async function listBills(
  scope: LedgerScope,
  filters: BillFilter = {},
): Promise<Bill[]> {
  const where: Prisma.BillWhereInput = {
    organizationId: scope.organizationId,
    ...(filters.status !== undefined ? { status: filters.status as Prisma.EnumBillStatus | Prisma.EnumBillStatus[] } : {}),
    ...(filters.supplierId !== undefined ? { supplierId: filters.supplierId } : {}),
    ...(filters.from !== undefined || filters.to !== undefined
      ? {
          billDate: {
            ...(filters.from !== undefined ? { gte: filters.from } : {}),
            ...(filters.to !== undefined ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  return prisma.bill.findMany({
    where,
    orderBy: { billDate: "desc" },
  });
}

export async function approveBill(
  scope: LedgerScope,
  billId: string,
  approverId: string,
): Promise<Bill> {
  return withTx(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, organizationId: scope.organizationId },
      include: { billLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (bill === null) {
      throw new NotFoundError(`bill ${billId} not found`);
    }
    if (bill.status === "PAID" || bill.status === "CANCELLED") {
      throw new Error(`cannot approve bill in ${bill.status} status`);
    }

    // Find the AP account for the supplier's organization.
    // Look for an account with code containing "AP" and type LIABILITY.
    const apAccounts = await tx.account.findMany({
      where: {
        organizationId: scope.organizationId,
        type: "LIABILITY",
        code: { contains: "AP", mode: "insensitive" },
      },
      select: { id: true, code: true },
      take: 10,
    });

    // Use the first Liability account containing "AP" in code, or fall back to first liability
    let apAccountId = apAccounts[0]?.id;
    if (!apAccountId) {
      // Fallback: find any liability account
      const liabilityAccount = await tx.account.findFirst({
        where: { organizationId: scope.organizationId, type: "LIABILITY" },
        select: { id: true },
      });
      if (!liabilityAccount) {
        throw new NotFoundError("no liability account found for A/P");
      }
      apAccountId = liabilityAccount.id;
    }

    // Find the current open period for the bill date
    const periods = await tx.period.findMany({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: bill.billDate },
        endDate: { gte: bill.billDate },
      },
      select: { id: true, status: true },
    });

    if (periods.length === 0) {
      throw new Error(`no accounting period covers bill date ${bill.billDate.toISOString().slice(0, 10)}`);
    }

    const period = periods[0];
    if (period.status !== "OPEN") {
      throw new Error(`period ${period.id} is ${period.status}, not OPEN`);
    }

    const periodId = period.id;

    // Build journal entry lines
    const normalisedLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      fxRate: Prisma.Decimal;
      reportingAmount: Prisma.Decimal;
      memo: string | null;
    }> = [];

    for (const line of bill.billLines) {
      const debitAmt = line.lineTotal;
      normalisedLines.push({
        accountId: line.accountId,
        debit: debitAmt,
        credit: new Prisma.Decimal(0),
        fxRate: new Prisma.Decimal(1),
        reportingAmount: reportingAmount(debitAmt, new Prisma.Decimal(0), new Prisma.Decimal(1)),
        memo: line.description,
      });

      if (line.taxAmount.gt(0)) {
        // Find or use AP account for tax
        normalisedLines.push({
          accountId: apAccountId,
          debit: line.taxAmount,
          credit: new Prisma.Decimal(0),
          fxRate: new Prisma.Decimal(1),
          reportingAmount: reportingAmount(line.taxAmount, new Prisma.Decimal(0), new Prisma.Decimal(1)),
          memo: `Tax on line ${line.lineNumber}`,
        });
      }
    }

    // Credit A/P for the full total
    normalisedLines.push({
      accountId: apAccountId,
      debit: new Prisma.Decimal(0),
      credit: bill.totalAmount,
      fxRate: new Prisma.Decimal(1),
      reportingAmount: reportingAmount(new Prisma.Decimal(0), bill.totalAmount, new Prisma.Decimal(1)),
      memo: `Bill ${bill.billNumber ?? bill.id} approval`,
    });

    // Verify balanced
    const debits = normalisedLines.reduce((s, l) => s.add(l.debit), ZERO);
    const credits = normalisedLines.reduce((s, l) => s.add(l.credit), ZERO);
    if (!debits.equals(credits)) {
      throw new UnbalancedEntryError(
        `journal entry for bill ${billId} is unbalanced: debits ${debits.toString()} vs credits ${credits.toString()}`,
      );
    }

    const journalNumber = await nextJournalNumber(
      tx,
      scope.organizationId,
      periodId,
    );

    // Create journal entry as draft
    const entry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId,
        entryDate: bill.billDate,
        description: `Approve bill ${bill.billNumber ?? bill.id}`,
        currency: bill.currency,
        sourceModule: "procurement",
        sourceId: bill.id,
      },
    });

    // Create lines
    await tx.journalLine.createMany({
      data: normalisedLines.map((line, index) => ({
        organizationId: scope.organizationId,
        journalEntryId: entry.id,
        accountId: line.accountId,
        lineNumber: index + 1,
        debit: line.debit,
        credit: line.credit,
        currency: bill.currency,
        fxRate: line.fxRate,
        reportingAmount: line.reportingAmount,
        memo: line.memo,
      })),
    });

    // Post the entry
    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { postedAt: new Date(), postedBy: approverId, journalNumber },
    });

    // Update bill status
    const updatedBill = await tx.bill.update({
      where: { id: billId },
      data: {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.bill.approve",
        entityType: "Bill",
        entityId: billId,
        before: { status: bill.status },
        after: { status: updatedBill.status, journalNumber },
      },
    });

    return updatedBill;
  });
}

export async function cancelBill(
  scope: LedgerScope,
  billId: string,
  reason: string,
): Promise<Bill> {
  return withTx(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, organizationId: scope.organizationId },
      include: { billLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (bill === null) {
      throw new NotFoundError(`bill ${billId} not found`);
    }
    if (bill.status === "PAID") {
      throw new Error("cannot cancel a paid bill");
    }

    if (bill.status === "APPROVED") {
      // Reverse the journal entry
      const originalEntry = await tx.journalEntry.findFirst({
        where: { sourceId: billId, sourceModule: "procurement" },
        select: { id: true, journalLines: { orderBy: { lineNumber: "asc" } } },
      });

      if (originalEntry) {
        // Find the period covering the bill date for reversal
        const periods = await tx.period.findMany({
          where: {
            organizationId: scope.organizationId,
            startDate: { lte: bill.billDate },
            endDate: { gte: bill.billDate },
          },
          select: { id: true, status: true },
        });

        if (periods.length > 0 && periods[0].status === "OPEN") {
          const reversalLines: Array<{
            accountId: string;
            debit: Prisma.Decimal;
            credit: Prisma.Decimal;
            fxRate: Prisma.Decimal;
            reportingAmount: Prisma.Decimal;
            memo: string | null;
          }> = originalEntry.journalLines.map((line) => ({
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            fxRate: line.fxRate,
            reportingAmount: reportingAmount(line.credit, line.debit, line.fxRate),
            memo: `Reversal of bill ${billId}`,
          }));

          // Verify reversal balanced
          const debits = reversalLines.reduce((s, l) => s.add(l.debit), ZERO);
          const credits = reversalLines.reduce((s, l) => s.add(l.credit), ZERO);
          if (!debits.equals(credits)) {
            throw new UnbalancedEntryError("reversal entry is unbalanced");
          }

          const journalNumber = await nextJournalNumber(
            tx,
            scope.organizationId,
            periods[0].id,
          );

          const reversalEntry = await tx.journalEntry.create({
            data: {
              organizationId: scope.organizationId,
              periodId: periods[0].id,
              entryDate: new Date(),
              description: `Cancel bill ${bill.billNumber ?? billId}: ${reason}`,
              currency: bill.currency,
              sourceModule: "procurement",
              sourceId: billId,
              reversalOfId: originalEntry.id,
            },
          });

          await tx.journalLine.createMany({
            data: reversalLines.map((line, index) => ({
              organizationId: scope.organizationId,
              journalEntryId: reversalEntry.id,
              accountId: line.accountId,
              lineNumber: index + 1,
              debit: line.debit,
              credit: line.credit,
              currency: bill.currency,
              fxRate: line.fxRate,
              reportingAmount: line.reportingAmount,
              memo: line.memo,
            })),
          });

          await tx.journalEntry.update({
            where: { id: reversalEntry.id },
            data: { postedAt: new Date(), postedBy: scope.userId, journalNumber },
          });

          // Mark original as reversed via raw SQL
          await tx.$executeRaw`
            UPDATE journal_entries SET reversed_by_id = ${reversalEntry.id}::uuid
            WHERE id = ${originalEntry.id}::uuid`;
        }
      }
    }

    const updatedBill = await tx.bill.update({
      where: { id: billId },
      data: { status: "CANCELLED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.bill.cancel",
        entityType: "Bill",
        entityId: billId,
        before: { status: bill.status },
        after: { status: "CANCELLED", reason },
      },
    });

    return updatedBill;
  });
}

export async function voidBill(
  scope: LedgerScope,
  billId: string,
): Promise<Bill> {
  return withTx(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, organizationId: scope.organizationId },
    });
    if (bill === null) {
      throw new NotFoundError(`bill ${billId} not found`);
    }
    if (bill.status !== "DRAFT") {
      throw new Error("only DRAFT bills can be voided");
    }

    const updatedBill = await tx.bill.update({
      where: { id: billId },
      data: { status: "CANCELLED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.bill.void",
        entityType: "Bill",
        entityId: billId,
        before: { status: bill.status },
        after: { status: "CANCELLED" },
      },
    });

    return updatedBill;
  });
}

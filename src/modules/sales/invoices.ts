import { Prisma } from "@prisma/client";
import { prisma, type TxClient } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";
import type { InvoiceStatus } from "./errors";

export type { InvoiceStatus } from "./errors";

export interface InvoiceLineInput {
  lineNumber: number;
  description: string;
  accountId: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string;
}

export interface CreateInvoiceInput {
  customerId: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  exchangeRate?: number | string;
  memo?: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

export interface InvoiceSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly invoiceNumber: number | null;
  readonly issueDate: Date;
  readonly dueDate: Date;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly status: InvoiceStatus;
  readonly subtotal: string;
  readonly taxAmount: string;
  readonly totalAmount: string;
  readonly amountPaid: string;
  readonly amountDue: string;
  readonly memo: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InvoiceFilters {
  status?: InvoiceStatus | InvoiceStatus[];
  from?: Date;
  to?: Date;
  customerId?: string;
}

const ZERO = new Prisma.Decimal(0);

/** Calculate subtotal, taxAmount and total from lines. */
function calcTotals(
  lines: InvoiceLineInput[],
): {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
} {
  let subtotal = ZERO;
  let taxTotal = ZERO;

  for (const line of lines) {
    const qty = new Prisma.Decimal(line.quantity);
    const price = new Prisma.Decimal(line.unitPrice);
    const rate = new Prisma.Decimal(line.taxRate ?? 0);
    const lineTotal = qty.mul(price);
    const lineTax = lineTotal.mul(rate).div(new Prisma.Decimal(100));
    subtotal = subtotal.add(lineTotal);
    taxTotal = taxTotal.add(lineTax);
  }

  const totalAmount = subtotal.add(taxTotal);
  return { subtotal, taxAmount: taxTotal, totalAmount };
}

/** Allocate the next invoice number for this organization. */
async function nextInvoiceNumber(
  tx: TxClient,
  organizationId: string,
): Promise<number> {
  // Upsert a counter row (id = organizationId), increment, return next.
  const rows = await tx.$queryRaw<
    Array<{ next_number: number }>
  >`
    WITH upsert AS (
      INSERT INTO sales_invoice_counters (organization_id, last_number)
      VALUES (${organizationId}::uuid, 1)
      ON CONFLICT (organization_id) DO UPDATE
        SET last_number = sales_invoice_counters.last_number + 1
    )
    SELECT last_number AS next_number
    FROM sales_invoice_counters
    WHERE organization_id = ${organizationId}::uuid
  `;

  return rows[0]?.next_number ?? 1;
}

export async function createInvoice(
  scope: LedgerScope,
  input: CreateInvoiceInput,
): Promise<InvoiceSummary> {
  return withTx(async (tx) => {
    // Verify customer exists and belongs to this org.
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: scope.organizationId },
      select: { id: true, name: true },
    });
    if (customer === null) {
      throw new NotFoundError(`customer ${input.customerId} not found`);
    }

    const { subtotal, taxAmount, totalAmount } = calcTotals(input.lines);
    const amountDue = totalAmount;

    const invoiceNumber = await nextInvoiceNumber(
      tx,
      scope.organizationId,
    );

    const invoice = await tx.invoice.create({
      data: {
        organizationId: scope.organizationId,
        customerId: input.customerId,
        invoiceNumber,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: input.currency,
        exchangeRate: input.exchangeRate ?? 1,
        status: "DRAFT",
        subtotal,
        taxAmount,
        totalAmount,
        amountPaid: ZERO,
        amountDue,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
      },
    });

    // Create lines — use a raw transaction within the outer tx.
    await tx.invoiceLine.createMany({
      data: input.lines.map((line) => {
        const qty = new Prisma.Decimal(line.quantity);
        const price = new Prisma.Decimal(line.unitPrice);
        const rate = new Prisma.Decimal(line.taxRate ?? 0);
        const lineTotal = qty.mul(price);
        const lineTax = lineTotal.mul(rate).div(new Prisma.Decimal(100));
        return {
          organizationId: scope.organizationId,
          invoiceId: invoice.id,
          lineNumber: line.lineNumber,
          description: line.description,
          accountId: line.accountId,
          quantity: qty,
          unitPrice: price,
          taxRate: rate,
          taxAmount: lineTax,
          lineTotal,
        };
      }),
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.invoice.create",
        entityType: "Invoice",
        entityId: invoice.id,
        after: {
          invoiceNumber,
          totalAmount: totalAmount.toString(),
          status: "DRAFT",
        },
      },
    });

    return toSummary(invoice, customer.name);
  });
}

export async function getInvoice(
  scope: LedgerScope,
  invoiceId: string,
): Promise<InvoiceSummary | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: scope.organizationId },
    include: { customer: { select: { name: true } } },
  });
  if (invoice === null) return null;
  return toSummary(
    invoice,
    (invoice as unknown as { customer: { name: string } }).customer.name,
  );
}

export async function listInvoices(
  scope: LedgerScope,
  filters?: InvoiceFilters,
): Promise<InvoiceSummary[]> {
  const whereConditions: Prisma.InvoiceWhereInput[] = [
    { organizationId: scope.organizationId },
    ...(filters?.status !== undefined
      ? Array.isArray(filters.status)
        ? [{ status: { in: filters.status } }]
        : [{ status: filters.status }]
      : []),
    ...(filters?.customerId !== undefined
      ? [{ customerId: filters.customerId }]
      : []),
  ];

  if (filters?.from !== undefined && filters?.to !== undefined) {
    whereConditions.push({ issueDate: { gte: filters.from, lte: filters.to } });
  } else if (filters?.from !== undefined) {
    whereConditions.push({ issueDate: { gte: filters.from } });
  } else if (filters?.to !== undefined) {
    whereConditions.push({ issueDate: { lte: filters.to } });
  }

  const where: Prisma.InvoiceWhereInput =
    whereConditions.length === 1
      ? whereConditions[0]
      : Object.assign({}, ...whereConditions);

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: "desc" },
    include: { customer: { select: { name: true } } },
  });

  return invoices.map((inv) =>
    toSummary(
      inv,
      (inv as unknown as { customer: { name: string } }).customer.name,
    ),
  );
}

/** Transition DRAFT → SENT and create GL journal entry. */
export async function postInvoice(
  scope: LedgerScope,
  invoiceId: string,
): Promise<void> {
  return withTx(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId },
      include: {
        invoiceLines: { orderBy: { lineNumber: "asc" } },
        customer: { select: { name: true } },
      },
    });
    if (invoice === null) {
      throw new NotFoundError(`invoice ${invoiceId} not found`);
    }
    if (invoice.status !== "DRAFT") {
      throw new Error(`invoice ${invoiceId} is ${invoice.status}, not DRAFT`);
    }

    // Find the period that covers the issue date.
    const period = await tx.period.findFirst({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: invoice.issueDate },
        endDate: { gte: invoice.issueDate },
      },
      select: { id: true, status: true },
    });
    if (period === null) {
      throw new NotFoundError(
        `no accounting period covers ${invoice.issueDate.toISOString().slice(0, 10)}`,
      );
    }
    if (period.status !== "OPEN") {
      throw new Error(
        `cannot post into period ${period.id}: status is ${period.status}`,
      );
    }

    // Find AR account for this org — look for an account with "receivable" or "asset" in code/name.
    // Fallback: find the first ASSET account.
    const arAccount = await tx.account.findFirst({
      where: {
        organizationId: scope.organizationId,
        code: "1200",
      },
      select: { id: true },
    });
    if (arAccount === null) {
      throw new NotFoundError(
        "Accounts Receivable account (code 1200) not found",
      );
    }

    const fxRate = new Prisma.Decimal(
      invoice.exchangeRate ?? 1,
    );

    // Build journal lines:
    // Line 1: Dr Accounts Receivable (total amount)
    const drLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      memo: string | null;
    }> = [
      {
        accountId: arAccount.id,
        debit: invoice.totalAmount,
        credit: ZERO,
        memo: `Invoice ${invoice.invoiceNumber}: ${invoice.customer.name}`,
      },
    ];

    // Lines 2+: Cr Income accounts per invoice line
    for (const line of invoice.invoiceLines) {
      drLines.push({
        accountId: line.accountId,
        debit: ZERO,
        credit: line.lineTotal,
        memo: `Line ${line.lineNumber}: ${line.description}`,
      });
    }

    // If there is tax, Cr Tax Payable
    if (invoice.taxAmount.greaterThan(ZERO)) {
      const taxAccount = await tx.account.findFirst({
        where: {
          organizationId: scope.organizationId,
          code: "2100",
        },
        select: { id: true },
      });
      if (taxAccount !== null) {
        drLines.push({
          accountId: taxAccount.id,
          debit: ZERO,
          credit: invoice.taxAmount,
          memo: `Tax on invoice ${invoice.invoiceNumber}`,
        });
      }
    }

    // Post the journal entry directly (we're already in a tx, so skip withTx).
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId: period.id,
        entryDate: invoice.issueDate,
        description: `Invoice ${invoice.invoiceNumber}: ${invoice.customer.name}`,
        currency: invoice.currency,
        sourceModule: "sales",
        sourceId: invoice.id,
      },
    });

    const reportingFx = fxRate;
    await tx.journalLine.createMany({
      data: drLines.map((line, idx) => ({
        organizationId: scope.organizationId,
        journalEntryId: journalEntry.id,
        accountId: line.accountId,
        lineNumber: idx + 1,
        debit: line.debit,
        credit: line.credit,
        currency: invoice.currency,
        fxRate: reportingFx,
        reportingAmount: new Prisma.Decimal(
          line.debit.add(line.credit).mul(reportingFx).toFixed(4, 1),
        ),
        memo: line.memo,
      })),
    });

    // Post the entry (set postedAt/postedBy to activate it).
    await tx.journalEntry.update({
      where: { id: journalEntry.id },
      data: {
        postedAt: new Date(),
        postedBy: scope.userId,
      },
    });

    // Update invoice status and amounts.
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "SENT",
        amountDue: invoice.totalAmount,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.invoice.post",
        entityType: "Invoice",
        entityId: invoiceId,
        after: {
          invoiceNumber: invoice.invoiceNumber,
          journalEntryId: journalEntry.id,
          status: "SENT",
          totalAmount: invoice.totalAmount.toString(),
        },
      },
    });
  });
}

/** Cancel an invoice. Only if not fully paid and not already cancelled. */
export async function cancelInvoice(
  scope: LedgerScope,
  invoiceId: string,
  reason: string,
): Promise<void> {
  return withTx(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId },
      select: { status: true, totalAmount: true, amountPaid: true },
    });
    if (invoice === null) {
      throw new NotFoundError(`invoice ${invoiceId} not found`);
    }
    if (invoice.status === "PAID" || invoice.status === "CANCELLED") {
      throw new Error(
        `invoice ${invoiceId} is ${invoice.status}, cannot cancel`,
      );
    }

    // If the invoice was already posted (SENT/PARTIAL), reverse the journal entry.
    if (invoice.status === "SENT") {
      const postedEntry = await tx.journalEntry.findFirst({
        where: {
          organizationId: scope.organizationId,
          sourceModule: "sales",
          sourceId: invoiceId,
          postedAt: { not: null },
        },
        select: { id: true },
      });
      if (postedEntry !== null) {
        // Create a reversal entry: swap debits and credits.
        const originalLines = await tx.journalLine.findMany({
          where: { journalEntryId: postedEntry.id },
          orderBy: { lineNumber: "asc" },
        });

        // Find the reversal period.
        const period = await tx.period.findFirst({
          where: {
            organizationId: scope.organizationId,
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
          select: { id: true, status: true },
        });
        if (period !== null && period.status === "OPEN") {
          const reversalEntry = await tx.journalEntry.create({
            data: {
              organizationId: scope.organizationId,
              periodId: period.id,
              entryDate: new Date(),
              description: `Cancellation of invoice ${invoice.invoiceNumber}: ${reason}`,
              currency: "USD",
              sourceModule: "sales",
              sourceId: invoiceId,
            },
          });

          await tx.journalLine.createMany({
            data: originalLines.map((line, idx) => ({
              organizationId: scope.organizationId,
              journalEntryId: reversalEntry.id,
              accountId: line.accountId,
              lineNumber: idx + 1,
              debit: line.credit,
              credit: line.debit,
              currency: line.currency,
              fxRate: line.fxRate,
              reportingAmount: new Prisma.Decimal(
                line.credit
                  .add(line.debit)
                  .mul(line.fxRate)
                  .toFixed(4, 1),
              ),
              memo: `Cancellation reversal of line ${line.lineNumber}`,
            })),
          });

          await tx.journalEntry.update({
            where: { id: reversalEntry.id },
            data: {
              postedAt: new Date(),
              postedBy: scope.userId,
              reversalOfId: postedEntry.id,
            },
          });

          // Mark the original as reversed.
          await tx.$executeRaw`
            UPDATE journal_entries SET reversed_by_id = ${reversalEntry.id}::uuid
            WHERE id = ${postedEntry.id}::uuid`;
        }
      }
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "CANCELLED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.invoice.cancel",
        entityType: "Invoice",
        entityId: invoiceId,
        after: { status: "CANCELLED", reason },
      },
    });
  });
}

/** Void a draft invoice (DRAFT only). No journal entry. */
export async function voidInvoice(
  scope: LedgerScope,
  invoiceId: string,
): Promise<void> {
  return withTx(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId },
      select: { status: true },
    });
    if (invoice === null) {
      throw new NotFoundError(`invoice ${invoiceId} not found`);
    }
    if (invoice.status !== "DRAFT") {
      throw new Error(
        `invoice ${invoiceId} is ${invoice.status}, only DRAFT can be voided`,
      );
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "CANCELLED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.invoice.void",
        entityType: "Invoice",
        entityId: invoiceId,
        after: { status: "CANCELLED" },
      },
    });
  });
}

/**
 * Map a DB row to an InvoiceSummary, pulling the customer name
 * from the pre-loaded relation.  The `invoice` shape matches what the
 * Prisma include above produces.
 */
function toSummary(
  invoice: {
    id: string;
    organizationId: string;
    customerId: string;
    invoiceNumber: number | null;
    issueDate: Date;
    dueDate: Date;
    currency: string;
    exchangeRate: Prisma.Decimal;
    status: InvoiceStatus;
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    amountDue: Prisma.Decimal;
    memo: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  customerName: string,
): InvoiceSummary {
  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    customerId: invoice.customerId,
    customerName,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate.toString(),
    status: invoice.status as InvoiceStatus,
    subtotal: invoice.subtotal.toString(),
    taxAmount: invoice.taxAmount.toString(),
    totalAmount: invoice.totalAmount.toString(),
    amountPaid: invoice.amountPaid.toString(),
    amountDue: invoice.amountDue.toString(),
    memo: invoice.memo,
    notes: invoice.notes,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

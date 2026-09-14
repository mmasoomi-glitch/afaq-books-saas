import { Prisma } from "@prisma/client";
import type { TxClient } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

const ZERO = new Prisma.Decimal(0);

export interface PaymentAllocationInput {
  invoiceId: string;
  amount: number | string;
}

export interface CreatePaymentInput {
  customerId: string;
  invoiceId?: string;
  paymentDate: Date;
  amount: number | string;
  currency: string;
  exchangeRate?: number | string;
  method: "WIRE" | "CHECK" | "CREDIT_CARD" | "CASH" | "ONLINE" | "CONNECTOR";
  reference?: string;
  memo?: string;
}

export interface PaymentAllocationResult {
  readonly invoiceId: string;
  readonly invoiceNumber: number | null;
  readonly amount: string;
}

export interface PaymentSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly invoiceId: string | null;
  readonly paymentNumber: number | null;
  readonly paymentDate: Date;
  readonly amount: string;
  readonly currency: string;
  readonly method: string;
  readonly reference: string | null;
  readonly memo: string | null;
  readonly allocations: readonly PaymentAllocationResult[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

async function nextPaymentNumber(
  tx: TxClient,
  organizationId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<
    Array<{ next_number: number }>
  >`
    WITH upsert AS (
      INSERT INTO sales_payment_counters (organization_id, last_number)
      VALUES (${organizationId}::uuid, 1)
      ON CONFLICT (organization_id) DO UPDATE
        SET last_number = sales_payment_counters.last_number + 1
    )
    SELECT last_number AS next_number
    FROM sales_payment_counters
    WHERE organization_id = ${organizationId}::uuid
  `;
  return rows[0]?.next_number ?? 1;
}

export async function createCustomerPayment(
  scope: LedgerScope,
  input: CreatePaymentInput,
): Promise<PaymentSummary> {
  return withTx(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (customer === null) {
      throw new NotFoundError(`customer ${input.customerId} not found`);
    }

    const paymentNumber = await nextPaymentNumber(
      tx,
      scope.organizationId,
    );

    const amount = new Prisma.Decimal(input.amount);

    const payment = await tx.customerPayment.create({
      data: {
        organizationId: scope.organizationId,
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? null,
        paymentNumber,
        paymentDate: input.paymentDate,
        amount,
        currency: input.currency,
        fxRate: new Prisma.Decimal(input.exchangeRate ?? 1),
        method: input.method,
        reference: input.reference ?? null,
        memo: input.memo ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.payment.create",
        entityType: "CustomerPayment",
        entityId: payment.id,
        after: {
          paymentNumber,
          amount: amount.toString(),
          method: input.method,
        },
      },
    });

    return toSummary(payment, []);
  });
}

export async function applyPayment(
  scope: LedgerScope,
  paymentId: string,
  allocations: PaymentAllocationInput[],
): Promise<void> {
  return withTx(async (tx) => {
    const payment = await tx.customerPayment.findFirst({
      where: { id: paymentId, organizationId: scope.organizationId },
      include: {
        invoice: { select: { status: true } },
      },
    });
    if (payment === null) {
      throw new NotFoundError(`payment ${paymentId} not found`);
    }
    if (payment.invoice?.status === "PAID") {
      throw new Error(`invoice for payment ${paymentId} is already PAID`);
    }

    const totalAllocated = allocations.reduce(
      (sum, a) => sum.add(new Prisma.Decimal(a.amount)),
      ZERO,
    );
    const paymentAmount = new Prisma.Decimal(payment.amount);

    if (totalAllocated.greaterThan(paymentAmount)) {
      throw new Error(
        `allocated ${totalAllocated.toString()} exceeds payment amount ${paymentAmount.toString()}`,
      );
    }

    // Verify all invoices exist and belong to this org.
    const invoiceIds = allocations.map((a) => a.invoiceId);
    const invoices = await tx.invoice.findMany({
      where: {
        id: { in: invoiceIds },
        organizationId: scope.organizationId,
      },
      select: { id: true, status: true, totalAmount: true, amountPaid: true, amountDue: true, currency: true },
    });
    const invoiceMap = new Map(
      invoices.map((inv) => [inv.id, inv]),
    );
    if (invoiceMap.size !== invoiceIds.length) {
      const found = new Set(invoices.map((i) => i.id));
      const missing = invoiceIds.filter((id) => !found.has(id));
      throw new NotFoundError(`invoice(s) not found: ${missing.join(", ")}`);
    }

    // Create allocations.
    for (const alloc of allocations) {
      const inv = invoiceMap.get(alloc.invoiceId);
      if (inv === undefined) continue;
      if (inv.status === "PAID" || inv.status === "CANCELLED") {
        throw new Error(
          `invoice ${alloc.invoiceId} is ${inv.status}, cannot allocate payment`,
        );
      }
    }

    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        organizationId: scope.organizationId,
        customerPaymentId: paymentId,
        invoiceId: a.invoiceId,
        amount: new Prisma.Decimal(a.amount),
      })),
    });

    // Find bank/cash account for this org.
    const bankAccount = await tx.account.findFirst({
      where: {
        organizationId: scope.organizationId,
        type: "ASSET",
        code: "1000",
      },
      select: { id: true },
    });
    if (bankAccount === null) {
      throw new NotFoundError(
        "Bank/Cash account (code 1000) not found",
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
      throw new NotFoundError(
        "Accounts Receivable account (code 1200) not found",
      );
    }

    // Find the period for the payment date.
    const period = await tx.period.findFirst({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: payment.paymentDate },
        endDate: { gte: payment.paymentDate },
      },
      select: { id: true, status: true },
    });
    if (period === null) {
      throw new NotFoundError(
        `no accounting period covers ${payment.paymentDate.toISOString().slice(0, 10)}`,
      );
    }
    if (period.status !== "OPEN") {
      throw new Error(
        `cannot post into period ${period.id}: status is ${period.status}`,
      );
    }

    // Post journal entry: Dr Bank/Cash, Cr A/R.
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId: period.id,
        entryDate: payment.paymentDate,
        description: `Payment ${payment.paymentNumber} for customer ${payment.customerId}`,
        currency: payment.currency,
        sourceModule: "sales",
        sourceId: paymentId,
      },
    });

    await tx.journalLine.createMany({
      data: [
        {
          organizationId: scope.organizationId,
          journalEntryId: journalEntry.id,
          accountId: bankAccount.id,
          lineNumber: 1,
          debit: paymentAmount,
          credit: ZERO,
          currency: payment.currency,
          fxRate: new Prisma.Decimal(payment.fxRate ?? 1),
          reportingAmount: new Prisma.Decimal(
            paymentAmount
              .add(ZERO)
              .mul(new Prisma.Decimal(payment.fxRate ?? 1))
              .toFixed(4, 1),
          ),
          memo: `Payment ${payment.paymentNumber}`,
        },
        {
          organizationId: scope.organizationId,
          journalEntryId: journalEntry.id,
          accountId: arAccount.id,
          lineNumber: 2,
          debit: ZERO,
          credit: paymentAmount,
          currency: payment.currency,
          fxRate: new Prisma.Decimal(payment.fxRate ?? 1),
          reportingAmount: new Prisma.Decimal(
            ZERO
              .add(paymentAmount)
              .mul(new Prisma.Decimal(payment.fxRate ?? 1))
              .toFixed(4, 1),
          ),
          memo: `Payment ${payment.paymentNumber} — A/R`,
        },
      ],
    });

    await tx.journalEntry.update({
      where: { id: journalEntry.id },
      data: {
        postedAt: new Date(),
        postedBy: scope.userId,
      },
    });

    // Update invoices: amountPaid and amountDue, and status.
    const applied = new Prisma.Decimal(
      allocations.reduce((s, a) => s + Number(a.amount), 0),
    );

    // Group allocations by invoice to handle each invoice's update.
    const byInvoice = new Map<string, Prisma.Decimal>();
    for (const a of allocations) {
      const existing = byInvoice.get(a.invoiceId) ?? ZERO;
      byInvoice.set(a.invoiceId, existing.add(new Prisma.Decimal(a.amount)));
    }

    for (const [invId, allocAmount] of byInvoice) {
      const inv = invoiceMap.get(invId);
      if (inv === undefined) continue;
      const newPaid = new Prisma.Decimal(inv.amountPaid).add(allocAmount);
      const newTotalAmount = new Prisma.Decimal(inv.totalAmount);
      const newDue = newTotalAmount.sub(newPaid);
      let newStatus = inv.status;
      if (newPaid.greaterThanOrEqualTo(newTotalAmount)) {
        newStatus = "PAID";
      } else if (newPaid.greaterThan(ZERO)) {
        newStatus = "PARTIAL";
      }

      await tx.invoice.update({
        where: { id: invId },
        data: {
          amountPaid: newPaid,
          amountDue: newDue,
          status: newStatus,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.payment.apply",
        entityType: "CustomerPayment",
        entityId: paymentId,
        after: {
          invoiceCount: allocations.length,
          applied: applied.toString(),
        },
      },
    });
  });
}

export async function unapplyPayment(
  scope: LedgerScope,
  allocationId: string,
): Promise<void> {
  return withTx(async (tx) => {
    const alloc = await tx.paymentAllocation.findFirst({
      where: { id: allocationId, organizationId: scope.organizationId },
      include: {
        customerPayment: true,
        invoice: true,
      },
    });
    if (alloc === null) {
      throw new NotFoundError(`allocation ${allocationId} not found`);
    }

    // Reverse the invoice amounts.
    void new Prisma.Decimal(alloc.customerPayment.amount);
    const newPaid = new Prisma.Decimal(alloc.invoice.amountPaid).sub(alloc.amount);
    const newDue = new Prisma.Decimal(alloc.invoice.totalAmount).sub(newPaid);

    let newStatus: string = alloc.invoice.status;
    if (newPaid.greaterThanOrEqualTo(new Prisma.Decimal(alloc.invoice.totalAmount))) {
      newStatus = "PAID";
    } else if (newPaid.greaterThan(ZERO)) {
      newStatus = "PARTIAL";
    } else {
      newStatus = "SENT";
    }

    await tx.invoice.update({
      where: { id: alloc.invoiceId },
      data: {
        amountPaid: newPaid,
        amountDue: newDue,
        status: newStatus as Prisma.EnumInvoiceStatus,
      },
    });

    // Delete the allocation.
    await tx.paymentAllocation.delete({
      where: { id: allocationId },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.payment.unapply",
        entityType: "PaymentAllocation",
        entityId: allocationId,
        after: { invoiceId: alloc.invoiceId, amount: alloc.amount.toString() },
      },
    });
  });
}

export async function recordUnappliedPayment(
  scope: LedgerScope,
  customerId: string,
  amount: number | string,
  method: "WIRE" | "CHECK" | "CREDIT_CARD" | "CASH" | "ONLINE" | "CONNECTOR",
  currency: string,
): Promise<PaymentSummary> {
  return createCustomerPayment(scope, {
    customerId,
    paymentDate: new Date(),
    amount,
    currency,
    method,
  });
}

function toSummary(
  payment: {
    id: string;
    organizationId: string;
    customerId: string;
    invoiceId: string | null;
    paymentNumber: number | null;
    paymentDate: Date;
    amount: Prisma.Decimal;
    currency: string;
    method: string;
    reference: string | null;
    memo: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  allocations: Array<{
    invoiceId: string;
    invoiceNumber: number | null;
    amount: Prisma.Decimal;
  }>,
): PaymentSummary {
  return {
    id: payment.id,
    organizationId: payment.organizationId,
    customerId: payment.customerId,
    invoiceId: payment.invoiceId,
    paymentNumber: payment.paymentNumber,
    paymentDate: payment.paymentDate,
    amount: payment.amount.toString(),
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    memo: payment.memo,
    allocations: allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber,
      amount: a.amount.toString(),
    })),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

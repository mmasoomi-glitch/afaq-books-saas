import { Prisma } from "@prisma/client";
import type { SupplierPayment, BillPaymentAllocation } from "@prisma/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";
import { nextJournalNumber, reportingAmount } from "./posting-helpers";

const ZERO = new Prisma.Decimal(0);

function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

export interface CreatePaymentInput {
  supplierId: string;
  billId?: string;
  paymentNumber?: number;
  paymentDate: Date;
  amount: string | number;
  currency?: string;
  exchangeRate?: string | number;
  method: string;
  reference?: string;
  memo?: string;
}

export interface PaymentAllocationInput {
  billId: string;
  amount: string | number;
}

export async function createSupplierPayment(
  scope: LedgerScope,
  input: CreatePaymentInput,
): Promise<SupplierPayment> {
  return withTx(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (supplier === null) {
      throw new NotFoundError(`supplier ${input.supplierId} not found`);
    }

    if (input.billId) {
      const bill = await tx.bill.findFirst({
        where: { id: input.billId, organizationId: scope.organizationId },
        select: { id: true },
      });
      if (bill === null) {
        throw new NotFoundError(`bill ${input.billId} not found`);
      }
    }

    const payment = await tx.supplierPayment.create({
      data: {
        organizationId: scope.organizationId,
        supplierId: input.supplierId,
        billId: input.billId ?? null,
        paymentNumber: input.paymentNumber ?? null,
        paymentDate: input.paymentDate,
        amount: dec(input.amount),
        currency: input.currency ?? "USD",
        exchangeRate: input.exchangeRate !== undefined ? dec(input.exchangeRate) : new Prisma.Decimal(1),
        method: input.method as Prisma.EnumSupplierPaymentMethod,
        reference: input.reference ?? null,
        memo: input.memo ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.payment.create",
        entityType: "SupplierPayment",
        entityId: payment.id,
        after: {
          paymentNumber: payment.paymentNumber,
          supplierId: payment.supplierId,
          amount: payment.amount.toString(),
          method: payment.method,
        },
      },
    });

    return payment;
  });
}

export async function applyPayment(
  scope: LedgerScope,
  paymentId: string,
  allocations: PaymentAllocationInput[],
): Promise<{ payment: SupplierPayment; allocations: BillPaymentAllocation[] }> {
  return withTx(async (tx) => {
    const payment = await tx.supplierPayment.findFirst({
      where: { id: paymentId, organizationId: scope.organizationId },
      include: { bill: { select: { id: true, status: true, amountDue: true } } },
    });
    if (payment === null) {
      throw new NotFoundError(`payment ${paymentId} not found`);
    }

    // Validate total allocation doesn't exceed payment amount
    const totalAllocated = allocations.reduce(
      (sum, a) => sum.add(dec(a.amount)),
      ZERO,
    );
    if (totalAllocated.gt(payment.amount)) {
      throw new Error(
        `allocation total ${totalAllocated.toString()} exceeds payment amount ${payment.amount.toString()}`,
      );
    }

    // Find AP account for journal entry
    const apAccounts = await tx.account.findMany({
      where: {
        organizationId: scope.organizationId,
        type: "LIABILITY",
        code: { contains: "AP", mode: "insensitive" },
      },
      select: { id: true },
      take: 10,
    });

    let apAccountId = apAccounts[0]?.id;
    if (!apAccountId) {
      const liabilityAccount = await tx.account.findFirst({
        where: { organizationId: scope.organizationId, type: "LIABILITY" },
        select: { id: true },
      });
      if (!liabilityAccount) {
        throw new NotFoundError("no liability account found for A/P");
      }
      apAccountId = liabilityAccount.id;
    }

    // Find bank/cash account
    const bankAccounts = await tx.account.findMany({
      where: {
        organizationId: scope.organizationId,
        type: "ASSET",
        code: { contains: "BANK", mode: "insensitive" },
      },
      select: { id: true },
      take: 10,
    });

    let bankAccountId = bankAccounts[0]?.id;
    if (!bankAccountId) {
      // Try CASH
      const cashAccounts = await tx.account.findMany({
        where: {
          organizationId: scope.organizationId,
          type: "ASSET",
          code: { contains: "CASH", mode: "insensitive" },
        },
        select: { id: true },
        take: 10,
      });
      bankAccountId = cashAccounts[0]?.id;
    }
    if (!bankAccountId) {
      // Fallback: first asset account
      const assetAccount = await tx.account.findFirst({
        where: { organizationId: scope.organizationId, type: "ASSET" },
        select: { id: true },
      });
      if (!assetAccount) {
        throw new NotFoundError("no asset/bank account found for payment");
      }
      bankAccountId = assetAccount.id;
    }

    // Find the current open period
    const periods = await tx.period.findMany({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: payment.paymentDate },
        endDate: { gte: payment.paymentDate },
      },
      select: { id: true, status: true },
      take: 1,
    });

    if (periods.length === 0) {
      throw new Error(`no accounting period covers payment date ${payment.paymentDate.toISOString().slice(0, 10)}`);
    }

    const periodId = periods[0].id;
    if (periods[0].status !== "OPEN") {
      throw new Error(`period ${periodId} is ${periods[0].status}, not OPEN`);
    }

    // Create journal entry: Dr A/P, Cr Bank
    const journalLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      fxRate: Prisma.Decimal;
      reportingAmount: Prisma.Decimal;
      memo: string | null;
    }> = [
      {
        accountId: apAccountId,
        debit: payment.amount,
        credit: new Prisma.Decimal(0),
        fxRate: new Prisma.Decimal(1),
        reportingAmount: reportingAmount(payment.amount, new Prisma.Decimal(0), new Prisma.Decimal(1)),
        memo: `Payment ${payment.paymentNumber ?? payment.id} to supplier ${payment.supplierId}`,
      },
      {
        accountId: bankAccountId,
        debit: new Prisma.Decimal(0),
        credit: payment.amount,
        fxRate: new Prisma.Decimal(1),
        reportingAmount: reportingAmount(new Prisma.Decimal(0), payment.amount, new Prisma.Decimal(1)),
        memo: `Payment ${payment.paymentNumber ?? payment.id}`,
      },
    ];

    const debits = journalLines.reduce((s, l) => s.add(l.debit), ZERO);
    const credits = journalLines.reduce((s, l) => s.add(l.credit), ZERO);
    if (!debits.equals(credits)) {
      throw new Error("payment journal entry is unbalanced");
    }

    const journalNumber = await nextJournalNumber(
      tx,
      scope.organizationId,
      periodId,
    );

    const entry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId,
        entryDate: payment.paymentDate,
        description: `Supplier payment ${payment.paymentNumber ?? payment.id}`,
        currency: payment.currency,
        sourceModule: "procurement",
        sourceId: payment.id,
      },
    });

    await tx.journalLine.createMany({
      data: journalLines.map((line, index) => ({
        organizationId: scope.organizationId,
        journalEntryId: entry.id,
        accountId: line.accountId,
        lineNumber: index + 1,
        debit: line.debit,
        credit: line.credit,
        currency: payment.currency,
        fxRate: line.fxRate,
        reportingAmount: line.reportingAmount,
        memo: line.memo,
      })),
    });

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { postedAt: new Date(), postedBy: scope.userId, journalNumber },
    });

    // Create allocations
    const createdAllocations: BillPaymentAllocation[] = [];

    for (const alloc of allocations) {
      const allocAmount = dec(alloc.amount);
      const bill = await tx.bill.findFirst({
        where: { id: alloc.billId, organizationId: scope.organizationId },
      });
      if (bill === null) {
        throw new NotFoundError(`bill ${alloc.billId} not found`);
      }

      const updatedBill = await tx.bill.update({
        where: { id: alloc.billId },
        data: {
          amountPaid: { increment: allocAmount },
          amountDue: { decrement: allocAmount },
        },
      });

      // Check if fully paid
      if (updatedBill.amountDue.lte(0)) {
        await tx.bill.update({
          where: { id: alloc.billId },
          data: { amountDue: new Prisma.Decimal(0), status: "PAID" },
        });
      } else if (updatedBill.status !== "PARTIAL") {
        await tx.bill.update({
          where: { id: alloc.billId },
          data: { status: "PARTIAL" },
        });
      }

      const created = await tx.billPaymentAllocation.create({
        data: {
          organizationId: scope.organizationId,
          supplierPaymentId: paymentId,
          billId: alloc.billId,
          amount: allocAmount,
        },
      });
      createdAllocations.push(created);
    }

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.payment.apply",
        entityType: "SupplierPayment",
        entityId: paymentId,
        after: {
          allocations: createdAllocations.map((a) => ({
            billId: a.billId,
            amount: a.amount.toString(),
          })),
        },
      },
    });

    return { payment, allocations: createdAllocations };
  });
}

export async function unapplyPayment(
  scope: LedgerScope,
  allocationId: string,
): Promise<BillPaymentAllocation> {
  return withTx(async (tx) => {
    const allocation = await tx.billPaymentAllocation.findFirst({
      where: {
        id: allocationId,
        organizationId: scope.organizationId,
      },
      include: { bill: true, supplierPayment: true },
    });
    if (allocation === null) {
      throw new NotFoundError(`allocation ${allocationId} not found`);
    }

    // Reverse the allocation: decrement amountPaid, increment amountDue
    await tx.bill.update({
      where: { id: allocation.billId },
      data: {
        amountPaid: { decrement: allocation.amount },
        amountDue: { increment: allocation.amount },
      },
    });

    const removed = await tx.billPaymentAllocation.delete({
      where: { id: allocationId },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.payment.unapply",
        entityType: "BillPaymentAllocation",
        entityId: allocationId,
        before: { billId: allocation.billId, amount: allocation.amount.toString() },
        after: { status: "removed" },
      },
    });

    return removed;
  });
}

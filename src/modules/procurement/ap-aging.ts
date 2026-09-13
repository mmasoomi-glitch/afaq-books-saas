import { Prisma } from "@prisma/client";
import type { Bill } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { LedgerScope } from "../ledger/scope";

const ZERO = new Prisma.Decimal(0);

export interface AgingBucket {
  label: string;
  fromDays: number;
  toDays: number | null;
  amount: string;
  billCount: number;
}

export interface SupplierAgingRow {
  supplierId: string;
  supplierName: string;
  currency: string;
  buckets: AgingBucket[];
  totalDue: string;
}

export interface APagingResult {
  asOf: Date;
  currency: string;
  suppliers: SupplierAgingRow[];
  totals: {
    current: string;
    oneToThirty: string;
    thirtyOneToSixty: string;
    sixtyOneToNinety: string;
    ninetyPlus: string;
    total: string;
  };
}

/**
 * Compute A/P aging by fetching all approved (non-paid, non-cancelled) bills
 * and bucketing their amountDue into standard aging buckets relative to asOf.
 */
export async function apAging(
  scope: LedgerScope,
  asOf: Date = new Date(),
): Promise<APagingResult> {
  const bills = await prisma.bill.findMany({
    where: {
      organizationId: scope.organizationId,
      status: { in: ["APPROVED", "PARTIAL"] },
      amountDue: { gt: 0 },
    },
    include: {
      supplier: { select: { id: true, name: true, currency: true } },
    },
  });

  const supplierMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      currency: string;
      buckets: AgingBucket[];
      totalDue: Prisma.Decimal;
    }
  >();

  // Global bucket totals
  let currentTotal = ZERO;
  let oneToThirtyTotal = ZERO;
  let thirtyOneToSixtyTotal = ZERO;
  let sixtyOneToNinetyTotal = ZERO;
  let ninetyPlusTotal = ZERO;

  for (const bill of bills) {
    const daysDue = Math.floor(
      (asOf.getTime() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24),
    );

    const supplierKey = bill.supplierId;
    if (!supplierMap.has(supplierKey)) {
      supplierMap.set(supplierKey, {
        supplierId: supplierKey,
        supplierName: bill.supplier.name,
        currency: bill.supplier.currency,
        buckets: [
          { label: "Current", fromDays: 0, toDays: 0, amount: "0", billCount: 0 },
          { label: "1-30", fromDays: 1, toDays: 30, amount: "0", billCount: 0 },
          { label: "31-60", fromDays: 31, toDays: 60, amount: "0", billCount: 0 },
          { label: "61-90", fromDays: 61, toDays: 90, amount: "0", billCount: 0 },
          { label: "90+", fromDays: 91, toDays: null, amount: "0", billCount: 0 },
        ],
        totalDue: new Prisma.Decimal(0),
      });
    }

    const row = supplierMap.get(supplierKey)!;
    const amountDue = new Prisma.Decimal(bill.amountDue);
    row.totalDue = row.totalDue.add(amountDue);

    // Bucket assignment
    const bucketIndex =
      daysDue < 0 ? 0 : daysDue <= 30 ? 1 : daysDue <= 60 ? 2 : daysDue <= 90 ? 3 : 4;

    row.buckets[bucketIndex].amount = new Prisma.Decimal(row.buckets[bucketIndex].amount).add(amountDue).toString();
    row.buckets[bucketIndex].billCount += 1;

    // Update global totals
    if (bucketIndex === 0) currentTotal = currentTotal.add(amountDue);
    else if (bucketIndex === 1) oneToThirtyTotal = oneToThirtyTotal.add(amountDue);
    else if (bucketIndex === 2) thirtyOneToSixtyTotal = thirtyOneToSixtyTotal.add(amountDue);
    else if (bucketIndex === 3) sixtyOneToNinetyTotal = sixtyOneToNinetyTotal.add(amountDue);
    else ninetyPlusTotal = ninetyPlusTotal.add(amountDue);
  }

  const suppliers = [...supplierMap.values()].map((row) => ({
    ...row,
    totalDue: row.totalDue.toString(),
    buckets: row.buckets.map((b) => ({
      ...b,
      amount: b.amount || "0",
    })),
  }));

  const grandTotal = currentTotal.add(oneToThirtyTotal).add(thirtyOneToSixtyTotal).add(sixtyOneToNinetyTotal).add(ninetyPlusTotal);

  return {
    asOf,
    currency: "USD",
    suppliers,
    totals: {
      current: currentTotal.toString(),
      oneToThirty: oneToThirtyTotal.toString(),
      thirtyOneToSixty: thirtyOneToSixtyTotal.toString(),
      sixtyOneToNinety: sixtyOneToNinetyTotal.toString(),
      ninetyPlus: ninetyPlusTotal.toString(),
      total: grandTotal.toString(),
    },
  };
}

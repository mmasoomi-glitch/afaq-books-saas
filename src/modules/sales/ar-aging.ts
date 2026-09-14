import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { LedgerScope } from "../ledger/scope";

const ZERO = new Prisma.Decimal(0);

export interface AgingBucket {
  readonly bucket: string;
  readonly totalDue: string;
}

export interface CustomerAging {
  readonly customerId: string;
  readonly customerName: string;
  readonly buckets: readonly AgingBucket[];
  readonly totalDue: string;
}

export interface ArAgingResult {
  readonly asOf: string;
  readonly customers: readonly CustomerAging[];
  readonly totals: readonly AgingBucket[];
}

export async function arAging(
  scope: LedgerScope,
  asOf: Date = new Date(),
): Promise<ArAgingResult> {
  const rows = await prisma.$queryRaw<Array<{
    customer_id: unknown;
    customer_name: unknown;
    bucket: string;
    sum_due: unknown;
  }>>(`
    SELECT
      c.id              AS customer_id,
      c.name            AS customer_name,
      CASE
        WHEN ${asOf}::date - i.due_date::date <= 0       THEN 'current'
        WHEN ${asOf}::date - i.due_date::date <= 30      THEN '1-30'
        WHEN ${asOf}::date - i.due_date::date <= 60      THEN '31-60'
        WHEN ${asOf}::date - i.due_date::date <= 90      THEN '61-90'
        ELSE '90+'
      END               AS bucket,
      COALESCE(SUM(i.amount_due), 0) AS sum_due
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.organization_id = ${scope.organizationId}::uuid
      AND i.status NOT IN ('PAID', 'CANCELLED')
      AND i.amount_due > 0
    GROUP BY c.id, c.name, bucket
    ORDER BY c.name, bucket
  `);

  // Bucket ordering by age.
  const bucketOrder: Record<string, number> = {
    current: 0,
    "1-30": 1,
    "31-60": 2,
    "61-90": 3,
    "90+": 4,
  };

  const customerMap = new Map<string, { name: string; buckets: AgingBucket[] }>();
  for (const row of rows) {
    const cid = String(row.customer_id);
    const entry = customerMap.get(cid) ?? { name: String(row.customer_name), buckets: [] };
    entry.buckets.push({
      bucket: row.bucket,
      totalDue: new Prisma.Decimal(String(row.sum_due)).toFixed(4),
    });
    customerMap.set(cid, entry);
  }

  const customers: CustomerAging[] = [];
  const grandTotal: Record<string, Prisma.Decimal> = {};

  for (const [cid, data] of customerMap) {
    // Sort buckets.
    data.buckets.sort((a, b) => bucketOrder[a.bucket] - bucketOrder[b.bucket]);

    let totalDue = ZERO;
    for (const b of data.buckets) {
      totalDue = totalDue.add(new Prisma.Decimal(b.totalDue));
      grandTotal[b.bucket] =
        (grandTotal[b.bucket] ?? ZERO).add(new Prisma.Decimal(b.totalDue));
    }

    customers.push({
      customerId: cid,
      customerName: data.name,
      buckets: data.buckets,
      totalDue: totalDue.toFixed(4),
    });
  }

  // Sort customers by total due descending.
  customers.sort((a, b) => {
    const diff = new Prisma.Decimal(b.totalDue).sub(new Prisma.Decimal(a.totalDue));
    return diff.toNumber();
  });

  const totals: AgingBucket[] = Object.keys(bucketOrder)
    .filter((b) => grandTotal[b])
    .map((b) => ({ bucket: b, totalDue: grandTotal[b]!.toFixed(4) }));

  return {
    asOf: asOf.toISOString(),
    customers,
    totals,
  };
}

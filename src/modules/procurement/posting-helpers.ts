import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);

export function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

/**
 * Must match the database CHECK jl_reporting_amount_consistent exactly:
 *   reporting_amount = round((debit + credit) * fx_rate, 4)
 */
export function reportingAmount(
  debit: Prisma.Decimal,
  credit: Prisma.Decimal,
  fxRate: Prisma.Decimal,
): Prisma.Decimal {
  return debit
    .add(credit)
    .mul(fxRate)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export interface NormalisedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  fxRate: Prisma.Decimal;
  reportingAmount: Prisma.Decimal;
  memo: string | null;
}

export async function nextJournalNumber(
  tx: TxClient,
  organizationId: string,
  periodId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO journal_counters (organization_id, period_id, last_number)
    VALUES (${organizationId}::uuid, ${periodId}::uuid, 0)
    ON CONFLICT (organization_id, period_id) DO NOTHING`;

  const rows = await tx.$queryRaw<Array<{ last_number: number }>>`
    SELECT last_number FROM journal_counters
    WHERE organization_id = ${organizationId}::uuid
      AND period_id = ${periodId}::uuid
    FOR UPDATE`;

  const current = rows[0];
  if (current === undefined) {
    throw new Error(`journal counter for period ${periodId} could not be allocated`);
  }

  const next = current.last_number + 1;
  await tx.$executeRaw`
    UPDATE journal_counters SET last_number = ${next}
    WHERE organization_id = ${organizationId}::uuid
      AND period_id = ${periodId}::uuid`;
  return next;
}

export async function requireOpenPeriod(
  tx: TxClient,
  scope: { organizationId: string },
  periodId: string,
): Promise<void> {
  const period = await tx.period.findFirst({
    where: { id: periodId, organizationId: scope.organizationId },
    select: { status: true },
  });
  if (period === null) {
    throw new Error(`period ${periodId} not found`);
  }
  if (period.status !== "OPEN") {
    throw new Error(`cannot post into period ${periodId}: status is ${period.status}`);
  }
}

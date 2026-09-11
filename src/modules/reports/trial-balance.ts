import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import { TrialBalanceUnbalancedError } from "./errors.js";
import type { LedgerScope } from "../ledger/scope.js";

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
  asOf: string;
}

type RawRow = {
  account_id: unknown;
  account_code: unknown;
  account_name: unknown;
  sum_debit: unknown;
  sum_credit: unknown;
};

/**
 * Postgres numerics arrive as a string or a Prisma.Decimal depending on the
 * driver path. Both are exact. Anything else is a surprise, and on a financial
 * report a surprise must stop the report rather than be silently coerced.
 *
 * There is deliberately NO fallback return. An earlier version returned "0"
 * for unrecognised input, which would have turned a driver or schema change
 * into a trial balance that quietly understated an account.
 */
function exactText(val: unknown, column: string): string {
  if (typeof val === "string") return val;
  if (val instanceof Prisma.Decimal) return val.toFixed(4);
  throw new Error(
    `trial balance: column ${column} came back as ${typeof val}, ` +
      `expected a string or Decimal; refusing to guess a value`,
  );
}

export async function trialBalance(
  scope: LedgerScope,
  asOf: Date,
): Promise<TrialBalanceResult> {
  const rowsRaw = await prisma.$queryRaw<RawRow[]>`
    SELECT
      a.id            AS account_id,
      a.code          AS account_code,
      a.name          AS account_name,
      COALESCE(SUM(j.debit),  0) AS sum_debit,
      COALESCE(SUM(j.credit), 0) AS sum_credit
    FROM journal_lines j
    INNER JOIN accounts a ON a.id = j.account_id
    INNER JOIN journal_entries je ON je.id = j.journal_entry_id
    WHERE j.organization_id = ${scope.organizationId}::uuid
      -- Filter the organization on EVERY joined table, not just journal_lines.
      -- The jl_org_consistency trigger already guarantees line, entry and
      -- account share an organization, so this is defence in depth rather than
      -- a fix for a known leak - but I7 says every query filters by
      -- organization_id, and a report is exactly where a silent cross-tenant
      -- join would do the most damage.
      AND je.organization_id = ${scope.organizationId}::uuid
      AND a.organization_id  = ${scope.organizationId}::uuid
      AND je.posted_at IS NOT NULL
      AND je.entry_date <= ${asOf}::date
    GROUP BY a.id, a.code, a.name
    HAVING SUM(j.debit) > 0 OR SUM(j.credit) > 0
    ORDER BY a.code ASC
  `;

  const rows: TrialBalanceRow[] = rowsRaw.map(
    (r: RawRow) => ({
    accountId: exactText(r.account_id, "account_id"),
    accountCode: exactText(r.account_code, "account_code"),
    accountName: exactText(r.account_name, "account_name"),
    debit: new Prisma.Decimal(exactText(r.sum_debit, "sum_debit")).toFixed(4),
    credit: new Prisma.Decimal(exactText(r.sum_credit, "sum_credit")).toFixed(4),
  }));

  const totalDebit = rows.reduce(
    (acc, r) => acc.plus(new Prisma.Decimal(r.debit)),
    new Prisma.Decimal(0),
  );
  const totalCredit = rows.reduce(
    (acc, r) => acc.plus(new Prisma.Decimal(r.credit)),
    new Prisma.Decimal(0),
  );

  const td = totalDebit.toFixed(4);
  const tc = totalCredit.toFixed(4);

  if (td !== tc) {
    throw new TrialBalanceUnbalancedError(td, tc);
  }

  return {
    rows,
    totalDebit: td,
    totalCredit: tc,
    asOf: asOf.toISOString(),
  };
}

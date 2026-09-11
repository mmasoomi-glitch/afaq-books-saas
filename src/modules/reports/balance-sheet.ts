import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import type { LedgerScope } from "../ledger/scope.js";

/**
 * Thrown when assets do not equal liabilities + equity + retained earnings.
 *
 * There is no tolerance. Every amount in this path is a Decimal, and Decimal
 * arithmetic is exact, so a tolerance could only ever hide a real imbalance —
 * which on a balance sheet means the ledger itself is wrong.
 */
export class BalanceSheetUnbalancedError extends Error {
  readonly code = "REPORT_BS_UNBALANCED";
  constructor(assets: string, liabilitiesPlusEquity: string, difference: string) {
    super(
      `balance sheet does not balance: assets ${assets} != ` +
        `liabilities + equity + retained earnings ${liabilitiesPlusEquity} ` +
        `(difference ${difference})`,
    );
    this.name = "BalanceSheetUnbalancedError";
  }
}

export interface BalanceSheetRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: string;
}

export interface BalanceSheet {
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  retainedEarnings: string;
  asOf: string;
}

function exactText(val: unknown, column: string): string {
  if (typeof val === "string") return val;
  if (val instanceof Prisma.Decimal) return val.toFixed(4);
  throw new Error(
    `balance sheet: column ${column} came back as ${typeof val}, ` +
      `expected a string or Decimal; refusing to guess a value`,
  );
}

/**
 * Balance sheet as at a date, cumulative from the beginning of the ledger.
 *
 * Income and expense accounts are never listed. They roll into retained
 * earnings, which is what makes the accounting identity hold:
 *
 *   assets = liabilities + equity + retained earnings
 *
 * That identity is enforced below, not assumed.
 */
export async function balanceSheet(
  scope: LedgerScope,
  asOf: Date,
): Promise<BalanceSheet> {
  const rows = await prisma.$queryRaw<
    Array<{
      account_id: string;
      account_code: string;
      account_name: string;
      account_type: string;
      amount: unknown;
    }>
  >`
    SELECT
      a.id   AS account_id,
      a.code AS account_code,
      a.name AS account_name,
      a.type::text AS account_type,
      SUM(
        CASE
          WHEN a.type = 'ASSET' THEN jl.debit  - jl.credit
          ELSE                       jl.credit - jl.debit
        END
      ) AS amount
    FROM journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
    INNER JOIN accounts a        ON a.id  = jl.account_id
    WHERE jl.organization_id = ${scope.organizationId}::uuid
      AND je.organization_id = ${scope.organizationId}::uuid
      AND a.organization_id  = ${scope.organizationId}::uuid
      AND je.posted_at IS NOT NULL
      AND je.entry_date <= ${asOf}::date
      AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
    GROUP BY a.id, a.code, a.name, a.type
    HAVING SUM(
      CASE
        WHEN a.type = 'ASSET' THEN jl.debit  - jl.credit
        ELSE                       jl.credit - jl.debit
      END
    ) <> 0
    ORDER BY a.code ASC
  `;

  const assets: BalanceSheetRow[] = [];
  const liabilities: BalanceSheetRow[] = [];
  const equity: BalanceSheetRow[] = [];
  let totalAssets = new Prisma.Decimal(0);
  let totalLiabilities = new Prisma.Decimal(0);
  let totalEquity = new Prisma.Decimal(0);

  for (const row of rows) {
    const amount = new Prisma.Decimal(exactText(row.amount, "amount"));
    const entry: BalanceSheetRow = {
      accountId: exactText(row.account_id, "account_id"),
      accountCode: exactText(row.account_code, "account_code"),
      accountName: exactText(row.account_name, "account_name"),
      amount: amount.toFixed(4),
    };

    if (row.account_type === "ASSET") {
      assets.push(entry);
      totalAssets = totalAssets.plus(amount);
    } else if (row.account_type === "LIABILITY") {
      liabilities.push(entry);
      totalLiabilities = totalLiabilities.plus(amount);
    } else if (row.account_type === "EQUITY") {
      equity.push(entry);
      totalEquity = totalEquity.plus(amount);
    } else {
      throw new Error(
        `balance sheet: account ${entry.accountCode} has unexpected type ` +
          `${String(row.account_type)}`,
      );
    }
  }

  // Retained earnings is the cumulative net profit of every income and expense
  // account up to asOf. Without it the identity cannot hold: those postings had
  // a balance-sheet counterpart, and nothing else in this report accounts for it.
  const earnings = await prisma.$queryRaw<Array<{ retained_earnings: unknown }>>`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN a.type = 'INCOME'  THEN jl.credit - jl.debit
          WHEN a.type = 'EXPENSE' THEN jl.debit  - jl.credit
          ELSE 0
        END
      ), 0) AS retained_earnings
    FROM journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
    INNER JOIN accounts a        ON a.id  = jl.account_id
    WHERE jl.organization_id = ${scope.organizationId}::uuid
      AND je.organization_id = ${scope.organizationId}::uuid
      AND a.organization_id  = ${scope.organizationId}::uuid
      AND je.posted_at IS NOT NULL
      AND je.entry_date <= ${asOf}::date
      AND a.type IN ('INCOME', 'EXPENSE')
  `;

  const earningsRow = earnings[0];
  if (earningsRow === undefined) {
    throw new Error(
      "balance sheet: the retained-earnings aggregate returned no row",
    );
  }
  const retainedEarnings = new Prisma.Decimal(
    exactText(earningsRow.retained_earnings, "retained_earnings"),
  );

  const rightHandSide = totalLiabilities
    .plus(totalEquity)
    .plus(retainedEarnings);

  if (!totalAssets.equals(rightHandSide)) {
    throw new BalanceSheetUnbalancedError(
      totalAssets.toFixed(4),
      rightHandSide.toFixed(4),
      totalAssets.minus(rightHandSide).toFixed(4),
    );
  }

  return {
    assets,
    liabilities,
    equity,
    totalAssets: totalAssets.toFixed(4),
    totalLiabilities: totalLiabilities.toFixed(4),
    totalEquity: totalEquity.toFixed(4),
    retainedEarnings: retainedEarnings.toFixed(4),
    asOf: asOf.toISOString(),
  };
}

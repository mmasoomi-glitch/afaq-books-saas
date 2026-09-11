import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import type { LedgerScope } from "../ledger/scope.js";

export interface ProfitAndLossRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: string;
}

export interface ProfitAndLoss {
  income: ProfitAndLossRow[];
  expenses: ProfitAndLossRow[];
  totalIncome: string;
  totalExpenses: string;
  netProfit: string;
  from: string;
  to: string;
}

/**
 * Postgres numerics arrive as a string or a Prisma.Decimal depending on the
 * driver path. Anything else is a surprise, and on a financial report a
 * surprise stops the report rather than being coerced. There is deliberately
 * no fallback return.
 */
function exactText(val: unknown, column: string): string {
  if (typeof val === "string") return val;
  if (val instanceof Prisma.Decimal) return val.toFixed(4);
  throw new Error(
    `profit and loss: column ${column} came back as ${typeof val}, ` +
      `expected a string or Decimal; refusing to guess a value`,
  );
}

/**
 * Profit and loss over a closed date range, derived only from posted rows.
 *
 * Income accounts carry a credit balance and expense accounts a debit balance,
 * so the sign is applied per account type in SQL and the result is a single
 * signed amount per account.
 */
export async function profitAndLoss(
  scope: LedgerScope,
  from: Date,
  to: Date,
): Promise<ProfitAndLoss> {
  if (to < from) {
    // An inverted range is a caller bug. Returning an empty report would hide
    // it behind something that looks like "this business did nothing".
    throw new Error(
      `profit and loss: 'to' (${to.toISOString()}) is before 'from' (${from.toISOString()})`,
    );
  }

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
          WHEN a.type = 'INCOME'  THEN jl.credit - jl.debit
          WHEN a.type = 'EXPENSE' THEN jl.debit  - jl.credit
          ELSE 0
        END
      ) AS amount
    FROM journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
    INNER JOIN accounts a        ON a.id  = jl.account_id
    WHERE jl.organization_id = ${scope.organizationId}::uuid
      -- Filter the organization on every joined table, not just journal_lines.
      -- A report is where a silent cross-tenant join would do the most damage.
      AND je.organization_id = ${scope.organizationId}::uuid
      AND a.organization_id  = ${scope.organizationId}::uuid
      AND je.posted_at IS NOT NULL
      AND je.entry_date >= ${from}::date
      AND je.entry_date <= ${to}::date
      AND a.type IN ('INCOME', 'EXPENSE')
    GROUP BY a.id, a.code, a.name, a.type
    HAVING SUM(
      CASE
        WHEN a.type = 'INCOME'  THEN jl.credit - jl.debit
        WHEN a.type = 'EXPENSE' THEN jl.debit  - jl.credit
        ELSE 0
      END
    ) <> 0
    ORDER BY a.code ASC
  `;

  const income: ProfitAndLossRow[] = [];
  const expenses: ProfitAndLossRow[] = [];
  let totalIncome = new Prisma.Decimal(0);
  let totalExpenses = new Prisma.Decimal(0);

  for (const row of rows) {
    const amount = new Prisma.Decimal(exactText(row.amount, "amount"));
    const entry: ProfitAndLossRow = {
      accountId: exactText(row.account_id, "account_id"),
      accountCode: exactText(row.account_code, "account_code"),
      accountName: exactText(row.account_name, "account_name"),
      amount: amount.toFixed(4),
    };

    if (row.account_type === "INCOME") {
      income.push(entry);
      totalIncome = totalIncome.plus(amount);
    } else if (row.account_type === "EXPENSE") {
      expenses.push(entry);
      totalExpenses = totalExpenses.plus(amount);
    } else {
      // The query already restricts the types, so this is unreachable unless
      // the enum changed underneath us. Say so rather than dropping the row.
      throw new Error(
        `profit and loss: account ${entry.accountCode} has unexpected type ` +
          `${String(row.account_type)}`,
      );
    }
  }

  return {
    income,
    expenses,
    totalIncome: totalIncome.toFixed(4),
    totalExpenses: totalExpenses.toFixed(4),
    netProfit: totalIncome.minus(totalExpenses).toFixed(4),
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

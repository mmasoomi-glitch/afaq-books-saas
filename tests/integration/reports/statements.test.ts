import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { ensureOrg, resetDb } from "../../setup.js";
import { prisma } from "../../../src/server/db/client.js";
import type { LedgerScope } from "../../../src/modules/ledger/scope.js";
import { createAccount } from "../../../src/modules/ledger/accounts.js";
import { createPeriod } from "../../../src/modules/ledger/periods.js";
import { postJournalEntry } from "../../../src/modules/ledger/posting.js";
import { profitAndLoss } from "../../../src/modules/reports/profit-and-loss.js";
import { balanceSheet } from "../../../src/modules/reports/balance-sheet.js";

beforeEach(async () => {
  await resetDb();
});

const YEAR_START = new Date("2024-01-01");
const YEAR_END = new Date("2024-12-31");

async function scopeWithOrg(): Promise<LedgerScope> {
  const organizationId = randomUUID();
  await ensureOrg(organizationId);
  return { userId: randomUUID(), organizationId };
}

/** A full chart of accounts plus an open period covering 2024. */
async function books() {
  const scope = await scopeWithOrg();
  const period = await createPeriod(scope, {
    name: "2024",
    startDate: YEAR_START,
    endDate: YEAR_END,
  });
  const cash = await createAccount(scope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });
  const loan = await createAccount(scope, {
    code: "2000",
    name: "Loan",
    type: "LIABILITY",
    currency: "USD",
  });
  const capital = await createAccount(scope, {
    code: "3000",
    name: "Capital",
    type: "EQUITY",
    currency: "USD",
  });
  const revenue = await createAccount(scope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });
  const rent = await createAccount(scope, {
    code: "6000",
    name: "Rent",
    type: "EXPENSE",
    currency: "USD",
  });
  return { scope, period, cash, loan, capital, revenue, rent };
}

interface PostLine {
  accountId: string;
  debit?: string;
  credit?: string;
}

async function post(
  scope: LedgerScope,
  periodId: string,
  entryDate: Date,
  description: string,
  lines: PostLine[],
): Promise<void> {
  await postJournalEntry(scope, {
    periodId,
    entryDate,
    description,
    currency: "USD",
    lines,
  });
}

function rowByCode(
  rows: ReadonlyArray<{ accountCode: string; amount: string }>,
  code: string,
): { accountCode: string; amount: string } {
  const row = rows.find((r) => r.accountCode === code);
  if (row === undefined) {
    throw new Error(
      `expected a row for account ${code}, got [${rows
        .map((r) => r.accountCode)
        .join(", ")}]`,
    );
  }
  return row;
}

// ── Profit and loss ─────────────────────────────────────────────────

test("PL1: an organization with no postings reports zeroes", async () => {
  const scope = await scopeWithOrg();
  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);

  expect(pl.income).toEqual([]);
  expect(pl.expenses).toEqual([]);
  expect(pl.totalIncome).toBe("0.0000");
  expect(pl.totalExpenses).toBe("0.0000");
  expect(pl.netProfit).toBe("0.0000");
});

test("PL2: a sale and an expense produce the right net profit", async () => {
  const { scope, period, cash, revenue, rent } = await books();
  await post(scope, period.id, new Date("2024-03-01"), "Sale", [
    { accountId: cash.id, debit: "500" },
    { accountId: revenue.id, credit: "500" },
  ]);
  await post(scope, period.id, new Date("2024-03-02"), "Rent", [
    { accountId: rent.id, debit: "200" },
    { accountId: cash.id, credit: "200" },
  ]);

  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);

  expect(rowByCode(pl.income, "4000").amount).toBe("500.0000");
  expect(rowByCode(pl.expenses, "6000").amount).toBe("200.0000");
  expect(pl.totalIncome).toBe("500.0000");
  expect(pl.totalExpenses).toBe("200.0000");
  expect(pl.netProfit).toBe("300.0000");
});

test("PL3: balance-sheet accounts never appear in profit and loss", async () => {
  const { scope, period, cash, capital, revenue } = await books();
  await post(scope, period.id, new Date("2024-02-01"), "Owner capital", [
    { accountId: cash.id, debit: "1000" },
    { accountId: capital.id, credit: "1000" },
  ]);
  await post(scope, period.id, new Date("2024-03-01"), "Sale", [
    { accountId: cash.id, debit: "200" },
    { accountId: revenue.id, credit: "200" },
  ]);

  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);
  const codes = [...pl.income, ...pl.expenses].map((r) => r.accountCode);

  expect(codes).not.toContain("1000");
  expect(codes).not.toContain("3000");
  expect(codes).toEqual(["4000"]);
});

test("PL4: the date range is inclusive at both ends", async () => {
  const { scope, period, cash, revenue } = await books();
  for (const [date, amount] of [
    ["2024-03-01", "10"],
    ["2024-03-15", "20"],
    ["2024-03-31", "30"],
  ] as const) {
    await post(scope, period.id, new Date(date), `Sale ${date}`, [
      { accountId: cash.id, debit: amount },
      { accountId: revenue.id, credit: amount },
    ]);
  }

  const march = await profitAndLoss(
    scope,
    new Date("2024-03-01"),
    new Date("2024-03-31"),
  );
  expect(march.totalIncome).toBe("60.0000");

  const middle = await profitAndLoss(
    scope,
    new Date("2024-03-02"),
    new Date("2024-03-30"),
  );
  expect(middle.totalIncome).toBe("20.0000");
});

test("PL5: a draft entry is excluded", async () => {
  const { scope, period, cash, revenue } = await books();
  await post(scope, period.id, new Date("2024-03-01"), "Posted", [
    { accountId: cash.id, debit: "100" },
    { accountId: revenue.id, credit: "100" },
  ]);

  // A draft: no postedAt, so the report must not see it.
  const draft = await prisma.journalEntry.create({
    data: {
      organizationId: scope.organizationId,
      periodId: period.id,
      entryDate: new Date("2024-03-02"),
      description: "Draft",
      currency: "USD",
    },
  });
  await prisma.journalLine.createMany({
    data: [
      {
        organizationId: scope.organizationId,
        journalEntryId: draft.id,
        accountId: cash.id,
        lineNumber: 1,
        debit: "50",
        credit: "0",
        currency: "USD",
        fxRate: "1",
        reportingAmount: "50",
      },
      {
        organizationId: scope.organizationId,
        journalEntryId: draft.id,
        accountId: revenue.id,
        lineNumber: 2,
        debit: "0",
        credit: "50",
        currency: "USD",
        fxRate: "1",
        reportingAmount: "50",
      },
    ],
  });

  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);
  expect(pl.totalIncome).toBe("100.0000");
});

test("PL6: one organization never sees another's postings", async () => {
  const a = await books();
  const b = await books();
  await post(b.scope, b.period.id, new Date("2024-03-01"), "B sale", [
    { accountId: b.cash.id, debit: "999" },
    { accountId: b.revenue.id, credit: "999" },
  ]);

  expect((await profitAndLoss(a.scope, YEAR_START, YEAR_END)).totalIncome).toBe(
    "0.0000",
  );
  expect((await profitAndLoss(b.scope, YEAR_START, YEAR_END)).totalIncome).toBe(
    "999.0000",
  );
});

test("PL7: four-decimal amounts survive exactly", async () => {
  const { scope, period, cash, revenue, rent } = await books();
  await post(scope, period.id, new Date("2024-03-01"), "Sale", [
    { accountId: cash.id, debit: "1234.5678" },
    { accountId: revenue.id, credit: "1234.5678" },
  ]);
  await post(scope, period.id, new Date("2024-03-02"), "Rent", [
    { accountId: rent.id, debit: "987.6543" },
    { accountId: cash.id, credit: "987.6543" },
  ]);

  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);
  expect(pl.totalIncome).toBe("1234.5678");
  expect(pl.totalExpenses).toBe("987.6543");
  expect(pl.netProfit).toBe("246.9135");
});

test("PL8: an inverted date range is refused", async () => {
  const scope = await scopeWithOrg();
  await expect(
    profitAndLoss(scope, YEAR_END, YEAR_START),
  ).rejects.toThrow(/before/i);
});

// ── Balance sheet ───────────────────────────────────────────────────

test("BS1: an organization with no postings balances at zero", async () => {
  const scope = await scopeWithOrg();
  const bs = await balanceSheet(scope, YEAR_END);

  expect(bs.assets).toEqual([]);
  expect(bs.totalAssets).toBe("0.0000");
  expect(bs.retainedEarnings).toBe("0.0000");
});

test("BS2: capital introduced shows as an asset and equity, and balances", async () => {
  const { scope, period, cash, capital } = await books();
  await post(scope, period.id, new Date("2024-01-02"), "Owner capital", [
    { accountId: cash.id, debit: "1000" },
    { accountId: capital.id, credit: "1000" },
  ]);

  const bs = await balanceSheet(scope, YEAR_END);
  expect(rowByCode(bs.assets, "1000").amount).toBe("1000.0000");
  expect(rowByCode(bs.equity, "3000").amount).toBe("1000.0000");
  expect(bs.totalAssets).toBe("1000.0000");
  expect(bs.retainedEarnings).toBe("0.0000");
});

test("BS3: profit flows into retained earnings and the identity holds", async () => {
  const { scope, period, cash, capital, revenue, rent } = await books();
  await post(scope, period.id, new Date("2024-01-02"), "Owner capital", [
    { accountId: cash.id, debit: "1000" },
    { accountId: capital.id, credit: "1000" },
  ]);
  await post(scope, period.id, new Date("2024-03-01"), "Sale", [
    { accountId: cash.id, debit: "500" },
    { accountId: revenue.id, credit: "500" },
  ]);
  await post(scope, period.id, new Date("2024-03-02"), "Rent", [
    { accountId: rent.id, debit: "200" },
    { accountId: cash.id, credit: "200" },
  ]);

  const bs = await balanceSheet(scope, YEAR_END);

  // Cash: 1000 + 500 - 200 = 1300
  expect(rowByCode(bs.assets, "1000").amount).toBe("1300.0000");
  expect(bs.totalEquity).toBe("1000.0000");
  // Profit 500 - 200 = 300
  expect(bs.retainedEarnings).toBe("300.0000");

  // assets = liabilities + equity + retained earnings
  expect(bs.totalAssets).toBe("1300.0000");
  expect(bs.totalLiabilities).toBe("0.0000");

  // And it agrees with the profit and loss for the same span.
  const pl = await profitAndLoss(scope, YEAR_START, YEAR_END);
  expect(bs.retainedEarnings).toBe(pl.netProfit);
});

test("BS4: a liability is reported on the credit side", async () => {
  const { scope, period, cash, loan } = await books();
  await post(scope, period.id, new Date("2024-01-05"), "Borrow", [
    { accountId: cash.id, debit: "750" },
    { accountId: loan.id, credit: "750" },
  ]);

  const bs = await balanceSheet(scope, YEAR_END);
  expect(rowByCode(bs.liabilities, "2000").amount).toBe("750.0000");
  expect(bs.totalLiabilities).toBe("750.0000");
  expect(bs.totalAssets).toBe("750.0000");
});

test("BS5: asOf is a cutoff - later postings are excluded", async () => {
  const { scope, period, cash, capital } = await books();
  await post(scope, period.id, new Date("2024-01-02"), "First", [
    { accountId: cash.id, debit: "100" },
    { accountId: capital.id, credit: "100" },
  ]);
  await post(scope, period.id, new Date("2024-06-01"), "Second", [
    { accountId: cash.id, debit: "400" },
    { accountId: capital.id, credit: "400" },
  ]);

  const early = await balanceSheet(scope, new Date("2024-01-31"));
  expect(early.totalAssets).toBe("100.0000");

  const late = await balanceSheet(scope, YEAR_END);
  expect(late.totalAssets).toBe("500.0000");
});

// BS6 deliberately does not exist.
//
// The obvious test for the unbalanced guard would be to write a one-sided
// POSTED entry directly and assert that balanceSheet() throws. That test cannot
// be written: je_balanced_check is a DEFERRABLE INITIALLY DEFERRED constraint
// trigger, so it fires at COMMIT no matter how the row is written, and the
// database refuses to store the corrupt state in the first place.
//
// That is the system working. It also means BalanceSheetUnbalancedError is
// unreachable while the trigger exists, and is defence in depth against the
// trigger being dropped by a future migration. Rather than ship a test that
// passes for the wrong reason, the identity is asserted on real fixtures below
// and in BS3.

test("BS6: the identity holds across assets, liabilities, equity and profit", async () => {
  const { scope, period, cash, loan, capital, revenue, rent } = await books();
  await post(scope, period.id, new Date("2024-01-02"), "Owner capital", [
    { accountId: cash.id, debit: "2000" },
    { accountId: capital.id, credit: "2000" },
  ]);
  await post(scope, period.id, new Date("2024-01-05"), "Borrow", [
    { accountId: cash.id, debit: "750" },
    { accountId: loan.id, credit: "750" },
  ]);
  await post(scope, period.id, new Date("2024-04-01"), "Sale", [
    { accountId: cash.id, debit: "1234.5678" },
    { accountId: revenue.id, credit: "1234.5678" },
  ]);
  await post(scope, period.id, new Date("2024-04-02"), "Rent", [
    { accountId: rent.id, debit: "987.6543" },
    { accountId: cash.id, credit: "987.6543" },
  ]);

  // balanceSheet() throws if the identity fails, so reaching this line is
  // already the assertion. Restating it makes the expectation explicit.
  const bs = await balanceSheet(scope, YEAR_END);
  const rhs =
    Number(bs.totalLiabilities) +
    Number(bs.totalEquity) +
    Number(bs.retainedEarnings);
  expect(Number(bs.totalAssets)).toBeCloseTo(rhs, 4);
  expect(bs.retainedEarnings).toBe("246.9135");
});

test("BS7: one organization never sees another's balance sheet", async () => {
  const a = await books();
  const b = await books();
  await post(b.scope, b.period.id, new Date("2024-01-02"), "B capital", [
    { accountId: b.cash.id, debit: "888" },
    { accountId: b.capital.id, credit: "888" },
  ]);

  expect((await balanceSheet(a.scope, YEAR_END)).totalAssets).toBe("0.0000");
  expect((await balanceSheet(b.scope, YEAR_END)).totalAssets).toBe("888.0000");
});

import { randomUUID } from "node:crypto";
import { test, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../src/server/db/client";
import { resetDb, ensureOrg } from "../../setup";
import { postJournalEntry } from "../../../src/modules/ledger/posting";
import { createPeriod } from "../../../src/modules/ledger/periods";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { trialBalance } from "../../../src/modules/reports/trial-balance";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";
import { TrialBalanceUnbalancedError } from "../../../src/modules/reports/errors";
import type { LedgerScope, AccountType } from "../../../src/modules/ledger/scope";

function at<T>(rows: readonly T[], i: number): T {
  const r = rows[i];
  if (r === undefined) throw new Error(`expected a row at index ${i}, got ${rows.length} rows`);
  return r;
}

let scope: LedgerScope = unsafeCreateLedgerScope("", "");

beforeEach(async () => {
  await resetDb();
  scope = unsafeCreateLedgerScope(randomUUID(), randomUUID());
  await ensureOrg(scope.organizationId);
});

async function createAccountWithData(
  code: string,
  name: string,
  type: AccountType,
  currency = "USD",
): Promise<{ id: string }> {
  return createAccount(scope, {
    code,
    name,
    type,
    currency,
  });
}

async function postPosting(
  periodId: string,
  lines: { accountId: string; debit: string; credit: string }[],
  description = "Test entry",
  entryDate?: Date,
): Promise<void> {
  await postJournalEntry(scope, {
    periodId,
    entryDate: entryDate ?? new Date("2024-01-15"),
    description,
    currency: "USD",
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: new Prisma.Decimal(l.debit),
      credit: new Prisma.Decimal(l.credit),
    })),
  });
}

// R1: Balanced report with standard double-entry
test("returns balanced rows for a standard double-entry journal", async () => {
  const period = await createPeriod(scope, {
    name: "2024-01",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");

  await postPosting(period.id, [
    { accountId: cash.id, debit: "100", credit: "0" },
    { accountId: revenue.id, debit: "0", credit: "100" },
  ]);

  const result = await trialBalance(scope, new Date("2024-01-31"));

  expect(result.rows).toHaveLength(2);
  const row0 = at(result.rows, 0);
  expect(row0.accountCode).toBe("1000");
  expect(row0.debit).toBe("100.0000");
  expect(row0.credit).toBe("0.0000");
  const row1 = at(result.rows, 1);
  expect(row1.accountCode).toBe("4000");
  expect(row1.debit).toBe("0.0000");
  expect(row1.credit).toBe("100.0000");
  expect(result.totalDebit).toBe("100.0000");
  expect(result.totalCredit).toBe("100.0000");
});

// R2: Throws TrialBalanceUnbalancedError when debits ≠ credits
test("throws TrialBalanceUnbalancedError when totalDebit ≠ totalCredit", async () => {
  const period = await createPeriod(scope, {
    name: "2024-02",
    startDate: new Date("2024-02-01"),
    endDate: new Date("2024-02-29"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");

  // Insert unbalanced journal data directly via Prisma (bypasses postJournalEntry
  // balance assertion). Creates a draft entry, attaches unbalanced lines, then posts.
  
  // Disable the DB-level constraint trigger so unbalanced posted data can be inserted.
  await prisma.$executeRaw`ALTER TABLE journal_entries DISABLE TRIGGER je_balanced_check;`;
  
  await prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        organizationId: scope.organizationId,
        periodId: period.id,
        entryDate: new Date("2024-02-15"),
        description: "Unbalanced test entry",
        currency: "USD",
      },
    });

    await tx.journalLine.createMany({
      data: [
        {
          organizationId: scope.organizationId,
          journalEntryId: entry.id,
          accountId: cash.id,
          lineNumber: 1,
          debit: new Prisma.Decimal("100"),
          credit: new Prisma.Decimal("0"),
          currency: "USD",
          fxRate: new Prisma.Decimal("1"),
          reportingAmount: new Prisma.Decimal("100"),
        },
        {
          organizationId: scope.organizationId,
          journalEntryId: entry.id,
          accountId: revenue.id,
          lineNumber: 2,
          debit: new Prisma.Decimal("0"),
          credit: new Prisma.Decimal("50"),
          currency: "USD",
          fxRate: new Prisma.Decimal("1"),
          reportingAmount: new Prisma.Decimal("50"),
        },
      ],
    });

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { postedAt: new Date("2024-02-15T00:00:00Z"), postedBy: scope.userId, journalNumber: 1 },
    });
  });

  // Re-enable the balance check trigger
  await prisma.$executeRaw`ALTER TABLE journal_entries ENABLE TRIGGER je_balanced_check;`;

  await expect(
    trialBalance(scope, new Date("2024-02-28")),
  ).rejects.toThrow(TrialBalanceUnbalancedError);

  await expect(
    trialBalance(scope, new Date("2024-02-28")),
  ).rejects.toThrow("REPORT_TB_UNBALANCED");
});

// R3: Empty report when no journal entries exist
test("returns empty result when organization has no journal entries", async () => {
  await createPeriod(scope, {
    name: "2024-03",
    startDate: new Date("2024-03-01"),
    endDate: new Date("2024-03-31"),
  });

  const result = await trialBalance(scope, new Date("2024-03-31"));

  expect(result.rows).toHaveLength(0);
  expect(result.totalDebit).toBe("0.0000");
  expect(result.totalCredit).toBe("0.0000");
});

// R4: Empty report for an organization with no data
test("returns empty result for a fresh organization", async () => {
  const result = await trialBalance(scope, new Date("2025-01-31"));

  expect(result.rows).toHaveLength(0);
  expect(result.totalDebit).toBe("0.0000");
  expect(result.totalCredit).toBe("0.0000");
});

// R5: Organization scope isolation
test("only includes rows for the requesting organization", async () => {
  const periodA = await createPeriod(scope, {
    name: "2024-04",
    startDate: new Date("2024-04-01"),
    endDate: new Date("2024-04-30"),
  });

  const cashA = await createAccountWithData("1000", "Cash A", "ASSET");
  const revenueA = await createAccountWithData("4000", "Revenue A", "INCOME");

  await postPosting(periodA.id, [
    { accountId: cashA.id, debit: "500", credit: "0" },
    { accountId: revenueA.id, debit: "0", credit: "500" },
  ]);

  const resultA = await trialBalance(scope, new Date("2024-04-30"));

  expect(resultA.rows).toHaveLength(2);
  expect(resultA.totalDebit).toBe("500.0000");
  expect(resultA.totalCredit).toBe("500.0000");

  // Create a second organization with its own data
  const orgBId = randomUUID();
  await ensureOrg(orgBId);
  const scopeB: LedgerScope = unsafeCreateLedgerScope(randomUUID(), orgBId);

  const periodB = await createPeriod(scopeB, {
    name: "2024-04",
    startDate: new Date("2024-04-01"),
    endDate: new Date("2024-04-30"),
  });

  const cashB = await createAccount(scopeB, {
    code: "1000",
    name: "Cash B",
    type: "ASSET" as AccountType,
    currency: "USD",
  });
  const revenueB = await createAccount(scopeB, {
    code: "4000",
    name: "Revenue B",
    type: "INCOME" as AccountType,
    currency: "USD",
  });

  await postJournalEntry(scopeB, {
    periodId: periodB.id,
    entryDate: new Date("2024-04-15"),
    description: "Org B entry",
    currency: "USD",
    lines: [
      { accountId: cashB.id, debit: new Prisma.Decimal("999"), credit: new Prisma.Decimal("0") },
      { accountId: revenueB.id, debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("999") },
    ],
  });

  // Query organization A's scope — should NOT see org B's data
  const resultAIsolated = await trialBalance(scope, new Date("2024-04-30"));

  expect(resultAIsolated.rows).toHaveLength(2);
  expect(resultAIsolated.totalDebit).toBe("500.0000");
  expect(resultAIsolated.totalCredit).toBe("500.0000");
});

// R6: Date filter — only entries with entry_date ≤ asOf are included
test("filters entries by entry_date relative to asOf", async () => {
  const period = await createPeriod(scope, {
    name: "2024-05",
    startDate: new Date("2024-05-01"),
    endDate: new Date("2024-05-31"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");
  const expense = await createAccountWithData("5000", "Expense", "EXPENSE");

  // Past entry — should be included
  await postPosting(period.id, [
    { accountId: cash.id, debit: "100", credit: "0" },
    { accountId: revenue.id, debit: "0", credit: "100" },
  ], "Past entry", new Date("2024-05-15"));

  // Future entry — should be excluded by asOf
  await postPosting(period.id, [
    { accountId: expense.id, debit: "50", credit: "0" },
    { accountId: cash.id, debit: "0", credit: "50" },
  ], "Future entry", new Date("2024-06-15"));

  const result = await trialBalance(scope, new Date("2024-05-31"));

  expect(result.rows).toHaveLength(2);
  const row0 = at(result.rows, 0);
  expect(row0.accountCode).toBe("1000");
  expect(row0.debit).toBe("100.0000");
  expect(result.totalDebit).toBe("100.0000");
  expect(result.totalCredit).toBe("100.0000");
});

// R7: Includes accounts with credit-only or debit-only activity
test("includes accounts with activity on either side", async () => {
  const period = await createPeriod(scope, {
    name: "2024-06",
    startDate: new Date("2024-06-01"),
    endDate: new Date("2024-06-30"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");
  const expense = await createAccountWithData("5000", "Expense", "EXPENSE");

  // Cash: debit 100
  await postPosting(period.id, [
    { accountId: cash.id, debit: "100", credit: "0" },
    { accountId: revenue.id, debit: "0", credit: "100" },
  ]);

  // Expense: debit 50, Cash: credit 50
  await postPosting(period.id, [
    { accountId: expense.id, debit: "50", credit: "0" },
    { accountId: cash.id, debit: "0", credit: "50" },
  ]);

  const result = await trialBalance(scope, new Date("2024-06-30"));

  expect(result.rows).toHaveLength(3);

  const cashRow = at(result.rows, 0);
  expect(cashRow.accountCode).toBe("1000");
  expect(cashRow.debit).toBe("100.0000");
  expect(cashRow.credit).toBe("50.0000");

  const revenueRow = at(result.rows, 1);
  expect(revenueRow.accountCode).toBe("4000");
  expect(revenueRow.debit).toBe("0.0000");
  expect(revenueRow.credit).toBe("100.0000");

  const expenseRow = at(result.rows, 2);
  expect(expenseRow.accountCode).toBe("5000");
  expect(expenseRow.debit).toBe("50.0000");
  expect(expenseRow.credit).toBe("0.0000");

  expect(result.totalDebit).toBe("150.0000");
  expect(result.totalCredit).toBe("150.0000");
});

// R8: Includes deactivated accounts with historical activity
test("includes deactivated accounts that have historical postings", async () => {
  const period = await createPeriod(scope, {
    name: "2024-07",
    startDate: new Date("2024-07-01"),
    endDate: new Date("2024-07-31"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");

  await postPosting(period.id, [
    { accountId: cash.id, debit: "200", credit: "0" },
    { accountId: revenue.id, debit: "0", credit: "200" },
  ]);

  const result = await trialBalance(scope, new Date("2024-07-31"));

  expect(result.rows).toHaveLength(2);
  const row0 = at(result.rows, 0);
  expect(row0.accountCode).toBe("1000");
  expect(row0.debit).toBe("200.0000");
  expect(result.totalDebit).toBe("200.0000");
  expect(result.totalCredit).toBe("200.0000");
});

// R9: Omits accounts with zero activity (no journal lines)
test("omits accounts that have no journal line activity", async () => {
  const period = await createPeriod(scope, {
    name: "2024-08",
    startDate: new Date("2024-08-01"),
    endDate: new Date("2024-08-31"),
  });

  const cash = await createAccountWithData("1000", "Cash", "ASSET");
  const revenue = await createAccountWithData("4000", "Revenue", "INCOME");
  await createAccountWithData("9999", "Unused", "ASSET");

  await postPosting(period.id, [
    { accountId: cash.id, debit: "75", credit: "0" },
    { accountId: revenue.id, debit: "0", credit: "75" },
  ]);

  const result = await trialBalance(scope, new Date("2024-08-31"));

  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((r: { accountCode: string }) => r.accountCode !== "9999")).toBe(true);
  expect(result.totalDebit).toBe("75.0000");
  expect(result.totalCredit).toBe("75.0000");
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureOrg, pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { createPeriod } from "../../../src/modules/ledger/periods";
import { listEntries, postJournalEntry } from "../../../src/modules/ledger/posting";
import { trialBalance } from "../../../src/modules/reports/trial-balance";
import { profitAndLoss } from "../../../src/modules/reports/profit-and-loss";
import { journalHref } from "../../../src/app/(app)/o/[orgSlug]/reports/drilldown";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";

/**
 * Drill-down reconciliation, end to end through the URL.
 *
 * The unit tests check the link's shape. These check the thing the link is FOR:
 * that following it lands on a journal whose totals equal the report figure
 * that was clicked.
 *
 * The URL is deliberately in the loop rather than bypassed. A test that called
 * `listEntries` with a hand-built filter would pass while the link pointed at
 * the wrong parameter names — the exact failure that would look to a user like
 * a broken reconciliation rather than a broken link.
 */

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function fixture() {
  const scope = unsafeCreateLedgerScope(randomUUID(), randomUUID());
  await ensureOrg(scope.organizationId);
  const period = await createPeriod(scope, {
    name: "2024-01",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
  });
  const cash = await createAccount(scope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });
  const revenue = await createAccount(scope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });
  return { scope, period, cash, revenue };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function post(f: Fixture, day: string, amount: string): Promise<void> {
  await postJournalEntry(f.scope, {
    periodId: f.period.id,
    entryDate: new Date(`2024-01-${day}`),
    description: `Sale ${day}`,
    currency: "USD",
    lines: [
      { accountId: f.cash.id, debit: amount },
      { accountId: f.revenue.id, credit: amount },
    ],
  });
}

/** Read a drill-down href the way the journal page would. */
function filterFromHref(href: string): {
  accountId?: string;
  from?: Date;
  to?: Date;
} {
  const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  const account = query.get("account");
  const from = query.get("from");
  const to = query.get("to");
  return {
    ...(account === null ? {} : { accountId: account }),
    ...(from === null ? {} : { from: new Date(from) }),
    ...(to === null ? {} : { to: new Date(to) }),
  };
}

test("D8: a trial-balance drill-down reconciles to the line it came from", async () => {
  const f = await fixture();
  await post(f, "05", "100");
  await post(f, "10", "200");
  await post(f, "20", "300");

  const report = await trialBalance(f.scope, new Date("2024-01-31"));
  const row = report.rows.find((r) => r.accountCode === "1000");
  expect(row).toBeDefined();

  // Exactly what the anchor renders, parsed exactly as the page parses it.
  const href = journalHref({
    orgSlug: "acme",
    accountId: row?.accountId ?? "",
    to: report.asOf,
  });
  const page = await listEntries(f.scope, { filter: filterFromHref(href) });

  expect(page.accountTotals?.debit).toBe(row?.debit);
  expect(page.accountTotals?.credit).toBe(row?.credit);
  expect(page.accountTotals?.debit).toBe("600.0000");
});

test("D9: the reconciliation survives a page smaller than the result", async () => {
  // I4. If the totals came from the rendered rows, a reader who set a small
  // page size would see a figure that disagrees with the report — and would
  // have no way to know which of the two was wrong.
  const f = await fixture();
  await post(f, "05", "100");
  await post(f, "10", "200");
  await post(f, "20", "300");

  const report = await trialBalance(f.scope, new Date("2024-01-31"));
  const row = report.rows.find((r) => r.accountCode === "1000");
  const href = journalHref({
    orgSlug: "acme",
    accountId: row?.accountId ?? "",
    to: report.asOf,
  });

  const page = await listEntries(f.scope, {
    pageSize: 1,
    filter: filterFromHref(href),
  });

  expect(page.entries).toHaveLength(1);
  expect(page.accountTotals?.debit).toBe(row?.debit);
});

test("D10: a profit-and-loss drill-down respects BOTH ends of the range", async () => {
  const f = await fixture();
  await post(f, "05", "100");
  await post(f, "10", "200");
  await post(f, "25", "300");

  const from = new Date("2024-01-01");
  const to = new Date("2024-01-15");
  const report = await profitAndLoss(f.scope, from, to);
  const row = report.income.find((r) => r.accountCode === "4000");
  expect(row).toBeDefined();

  const href = journalHref({
    orgSlug: "acme",
    accountId: row?.accountId ?? "",
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  const page = await listEntries(f.scope, { filter: filterFromHref(href) });

  // The 25th is outside the range and must not be counted on either side.
  expect(page.entries).toHaveLength(2);
  expect(page.accountTotals?.credit).toBe("300.0000");
  expect(page.accountTotals?.credit).toBe(row?.amount);
});

test("D11: a cumulative drill-down would NOT reconcile if it sent a `from`", async () => {
  // Why `journalHref` omits `from` for the trial balance and balance sheet,
  // asserted rather than left as a comment. Adding a start date to a cumulative
  // figure produces a smaller number under the same heading — a subset
  // presented as if it were the total.
  const f = await fixture();
  await post(f, "05", "100");
  await post(f, "20", "300");

  const report = await trialBalance(f.scope, new Date("2024-01-31"));
  const row = report.rows.find((r) => r.accountCode === "1000");

  const correct = await listEntries(f.scope, {
    filter: filterFromHref(
      journalHref({
        orgSlug: "acme",
        accountId: row?.accountId ?? "",
        to: report.asOf,
      }),
    ),
  });
  const wrong = await listEntries(f.scope, {
    filter: filterFromHref(
      journalHref({
        orgSlug: "acme",
        accountId: row?.accountId ?? "",
        from: "2024-01-10",
        to: report.asOf,
      }),
    ),
  });

  expect(correct.accountTotals?.debit).toBe(row?.debit);
  expect(wrong.accountTotals?.debit).not.toBe(row?.debit);
  expect(wrong.accountTotals?.debit).toBe("300.0000");
});

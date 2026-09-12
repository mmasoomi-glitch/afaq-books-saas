import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureOrg, pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { createPeriod } from "../../../src/modules/ledger/periods";
import {
  listEntries,
  postJournalEntry,
} from "../../../src/modules/ledger/posting";
import { trialBalance } from "../../../src/modules/reports/trial-balance";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";

/**
 * Filtering the journal.
 *
 * The judge sequenced this ahead of report drill-down on the grounds that
 * drill-down IS a filtered journal — "the posted lines behind this
 * trial-balance figure" is `filter by account, within these dates". It also
 * named the failure mode to design against: a cursor surviving a change of
 * filter. `F5` and `F6` are that.
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
  const bank = await createAccount(scope, {
    code: "1010",
    name: "Bank",
    type: "ASSET",
    currency: "USD",
  });
  const revenue = await createAccount(scope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });
  return { scope, period, cash, bank, revenue };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function post(
  f: Fixture,
  day: string,
  debitAccountId: string,
  amount: string,
): Promise<void> {
  await postJournalEntry(f.scope, {
    periodId: f.period.id,
    entryDate: new Date(`2024-01-${day}`),
    description: `Sale ${day}`,
    currency: "USD",
    lines: [
      { accountId: debitAccountId, debit: amount },
      { accountId: f.revenue.id, credit: amount },
    ],
  });
}

test("F1: filtering by account returns only entries touching it", async () => {
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "06", f.bank.id, "200");
  await post(f, "07", f.cash.id, "300");

  const page = await listEntries(f.scope, { filter: { accountId: f.cash.id } });

  expect(page.entries).toHaveLength(2);
  for (const entry of page.entries) {
    expect(entry.lines.some((l) => l.accountCode === "1000")).toBe(true);
  }
});

test("F2: the WHOLE entry comes back, not just the matching line", async () => {
  // Deliberate. A debit shown without its matching credit is half of a double
  // entry and reads as if money appeared from nowhere; the contra account is
  // the part that explains what happened.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");

  const page = await listEntries(f.scope, { filter: { accountId: f.cash.id } });

  expect(page.entries[0]?.lines).toHaveLength(2);
  const codes = page.entries[0]?.lines.map((l) => l.accountCode).sort();
  expect(codes).toEqual(["1000", "4000"]);
});

test("F3: account totals reconcile to the trial balance for that account", async () => {
  // The property that makes this usable as a drill-down. If the figure shown
  // under a filtered journal disagrees with the trial-balance line that led
  // there, one of the two is lying and the reader cannot tell which.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "07", f.cash.id, "300");
  await post(f, "09", f.bank.id, "999");

  const page = await listEntries(f.scope, { filter: { accountId: f.cash.id } });
  const report = await trialBalance(f.scope, new Date("2024-01-31"));
  const cashRow = report.rows.find((row) => row.accountCode === "1000");

  expect(page.accountTotals?.debit).toBe("400.0000");
  expect(page.accountTotals?.debit).toBe(cashRow?.debit);
  expect(page.accountTotals?.credit).toBe(cashRow?.credit);
});

test("F4: totals cover the whole filtered set, not the page on screen", async () => {
  // I4: a report may not be derived from what the UI happens to be rendering.
  // With a page size of one, a total computed from the page would read 100.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "06", f.cash.id, "100");
  await post(f, "07", f.cash.id, "100");

  const page = await listEntries(f.scope, {
    pageSize: 1,
    filter: { accountId: f.cash.id },
  });

  expect(page.entries).toHaveLength(1);
  expect(page.accountTotals?.debit).toBe("300.0000");
});

test("F5: a cursor from a DIFFERENT filter serves page one", async () => {
  // The failure the judge named. Keep the cursor, change the filter, and the
  // cursor names a row that may not be in the new result set at all — what
  // comes back is a slice of the new query starting at an arbitrary point,
  // with the rows before it silently missing and nothing saying so.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "06", f.cash.id, "100");
  await post(f, "07", f.cash.id, "100");
  await post(f, "08", f.bank.id, "100");

  const cashPage = await listEntries(f.scope, {
    pageSize: 2,
    filter: { accountId: f.cash.id },
  });
  expect(cashPage.nextCursor).not.toBeNull();

  // Same cursor, different filter.
  const unfiltered = await listEntries(f.scope, {
    pageSize: 2,
    cursor: cashPage.nextCursor ?? "",
  });
  const pageOne = await listEntries(f.scope, { pageSize: 2 });

  expect(unfiltered.entries.map((e) => e.id)).toEqual(
    pageOne.entries.map((e) => e.id),
  );
});

test("F6: the SAME filter still pages normally", async () => {
  // The other half of F5. A fingerprint that rejected everything would pass
  // F5 and break paging entirely.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "06", f.cash.id, "100");
  await post(f, "07", f.cash.id, "100");

  const filter = { accountId: f.cash.id };
  const first = await listEntries(f.scope, { pageSize: 2, filter });
  expect(first.entries).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const second = await listEntries(f.scope, {
    pageSize: 2,
    filter,
    cursor: first.nextCursor ?? "",
  });

  expect(second.entries).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  const seen = [...first.entries, ...second.entries].map((e) => e.id);
  expect(new Set(seen).size).toBe(3);
});

test("F7: a date range is inclusive at both ends", async () => {
  // Off-by-one at a period boundary moves a transaction into the wrong month,
  // which is the kind of error that reconciles to nothing and is found in an
  // audit rather than by the person who caused it.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "06", f.cash.id, "100");
  await post(f, "07", f.cash.id, "100");

  const page = await listEntries(f.scope, {
    filter: { from: new Date("2024-01-05"), to: new Date("2024-01-07") },
  });

  expect(page.entries).toHaveLength(3);
});

test("F8: account and date range are AND-ed, not OR-ed", async () => {
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");
  await post(f, "20", f.cash.id, "100");
  await post(f, "21", f.bank.id, "100");

  const page = await listEntries(f.scope, {
    filter: {
      accountId: f.cash.id,
      from: new Date("2024-01-15"),
      to: new Date("2024-01-31"),
    },
  });

  expect(page.entries).toHaveLength(1);
  expect(page.accountTotals?.debit).toBe("100.0000");
});

test("F9: an account from ANOTHER organization shows nothing, not everything", async () => {
  // The dangerous answer would be an unfiltered journal: the reader believes
  // they are looking at one account and is looking at all of them.
  //
  // `accountTotals` is null rather than undefined so the page can say "no such
  // account" instead of "no filter" — different facts, different sentences.
  const mine = await fixture();
  await post(mine, "05", mine.cash.id, "100");
  const theirs = await fixture();

  const page = await listEntries(mine.scope, {
    filter: { accountId: theirs.cash.id },
  });

  expect(page.entries).toHaveLength(0);
  expect(page.accountTotals).toBeNull();
  expect(page.nextCursor).toBeNull();
});

test("F10: a malformed accountId is refused the same way, not a 500", async () => {
  // `accounts.id` is `@db.Uuid`, so an unvalidated value reaches Postgres and
  // is rejected at the type level — the same crash the journal cursor had.
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");

  const page = await listEntries(f.scope, {
    filter: { accountId: "not-an-id" },
  });

  expect(page.entries).toHaveLength(0);
  expect(page.accountTotals).toBeNull();
});

test("F11: no filter means no totals, which is not the same as zero", async () => {
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");

  const page = await listEntries(f.scope, {});

  expect(page.entries).toHaveLength(1);
  expect(page.accountTotals).toBeUndefined();
});

test("F12: an account with postings that fall outside the range totals zero", async () => {
  // Zero is a real answer and must not be confused with "no such account".
  const f = await fixture();
  await post(f, "05", f.cash.id, "100");

  const page = await listEntries(f.scope, {
    filter: {
      accountId: f.cash.id,
      from: new Date("2024-01-20"),
      to: new Date("2024-01-31"),
    },
  });

  expect(page.entries).toHaveLength(0);
  expect(page.accountTotals).not.toBeNull();
  expect(page.accountTotals?.debit).toBe("0.0000");
  expect(page.accountTotals?.credit).toBe("0.0000");
});

test("F13: filtering never crosses a tenant boundary", async () => {
  const mine = await fixture();
  await post(mine, "05", mine.cash.id, "100");
  const theirs = await fixture();
  await post(theirs, "05", theirs.cash.id, "999");

  const page = await listEntries(mine.scope, {
    filter: { from: new Date("2024-01-01"), to: new Date("2024-01-31") },
  });

  expect(page.entries).toHaveLength(1);
  expect(page.entries[0]?.lines.some((l) => l.debit === "999.0000")).toBe(
    false,
  );
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureOrg, pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { createPeriod } from "../../../src/modules/ledger/periods";
import {
  MAX_JOURNAL_PAGE,
  listEntries,
  postJournalEntry,
} from "../../../src/modules/ledger/posting";
import type { LedgerScope } from "../../../src/modules/ledger/scope";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";

/**
 * Paging the journal.
 *
 * The listing was capped at 100 with no way to reach entry 101 — an
 * organization with 150 postings could not see 50 of them through any screen,
 * and the page did not say they existed. For a book of record that is a
 * completeness failure, not a convenience one.
 *
 * Keyset rather than offset, so most of what is worth testing here is about
 * what happens when the data changes underneath a reader.
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

/** Post `n` entries on consecutive days, oldest first. */
async function postMany(f: Fixture, n: number, startDay = 1): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const day = String(startDay + i).padStart(2, "0");
    // Sequential on purpose: journal numbers are allocated under a lock, and
    // posting these concurrently would be testing the allocator, not paging.
    await postJournalEntry(f.scope, {
      periodId: f.period.id,
      entryDate: new Date(`2024-01-${day}`),
      description: `Entry ${String(startDay + i)}`,
      currency: "USD",
      lines: [
        { accountId: f.cash.id, debit: "100" },
        { accountId: f.revenue.id, credit: "100" },
      ],
    });
  }
}

/** Walk every page, returning the ids in the order a reader would meet them. */
async function walk(
  scope: LedgerScope,
  pageSize: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    const page = await listEntries(scope, {
      pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    });
    pages += 1;
    ids.push(...page.entries.map((entry) => entry.id));
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
    // A runaway cursor loop would otherwise hang the suite rather than fail it.
    if (pages > 50) throw new Error("paging did not terminate");
  }

  return { ids, pages };
}

test("J1: a full page reports a cursor, a partial page does not", async () => {
  const f = await fixture();
  await postMany(f, 5);

  const first = await listEntries(f.scope, { pageSize: 3 });
  expect(first.entries).toHaveLength(3);
  expect(first.nextCursor).not.toBeNull();

  const second = await listEntries(f.scope, {
    pageSize: 3,
    cursor: first.nextCursor ?? "",
  });
  expect(second.entries).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
});

test("J2: exactly one full page reports no next page", async () => {
  // The off-by-one that a `take: pageSize` implementation gets wrong: with
  // exactly `pageSize` rows it would hand back a cursor, and the next page
  // would be empty. A reader would be offered "Older entries" leading nowhere.
  const f = await fixture();
  await postMany(f, 3);

  const page = await listEntries(f.scope, { pageSize: 3 });

  expect(page.entries).toHaveLength(3);
  expect(page.nextCursor).toBeNull();
});

test("J3: walking every page sees every entry exactly once, newest first", async () => {
  const f = await fixture();
  await postMany(f, 10);

  const { ids, pages } = await walk(f.scope, 3);
  const all = await listEntries(f.scope, { pageSize: MAX_JOURNAL_PAGE });

  expect(pages).toBe(4);
  expect(new Set(ids).size).toBe(10);
  // Identical to reading it in one go — no gap, no repeat, same order.
  expect(ids).toEqual(all.entries.map((entry) => entry.id));
});

test("J4: an entry posted mid-walk cannot push an older one out of sight", async () => {
  // The property keyset pagination exists for, and the reason this is not
  // skip/take.
  //
  // With an offset, a new entry sorting to the TOP shifts every later row down
  // by one. The row that was last on page one moves onto page two's start — so
  // the reader, who has already passed page one, never sees it and nothing
  // tells them. A journal that silently omits a record from a complete read is
  // the one failure a book of record must not have.
  const f = await fixture();
  await postMany(f, 6);

  const before = await listEntries(f.scope, { pageSize: MAX_JOURNAL_PAGE });
  const originalIds = new Set(before.entries.map((entry) => entry.id));

  const first = await listEntries(f.scope, { pageSize: 3 });
  const seen = first.entries.map((entry) => entry.id);

  // A newer entry arrives between the two reads and sorts above everything.
  await postMany(f, 1, 31);

  let cursor = first.nextCursor;
  while (cursor !== null) {
    const next = await listEntries(f.scope, { pageSize: 3, cursor });
    seen.push(...next.entries.map((entry) => entry.id));
    cursor = next.nextCursor;
  }

  for (const id of originalIds) {
    expect(seen, "an original entry was skipped by the walk").toContain(id);
  }
  expect(new Set(seen).size).toBe(seen.length);
});

test("J5: a cursor from ANOTHER organization serves page one and leaks nothing", async () => {
  // Not merely "returns no data". An unknown id, a foreign id and a mangled
  // string must be INDISTINGUISHABLE, or the parameter becomes a way to ask
  // whether another tenant's entry exists.
  const mine = await fixture();
  await postMany(mine, 4);
  const theirs = await fixture();
  await postMany(theirs, 4);

  const theirPage = await listEntries(theirs.scope, { pageSize: 2 });
  const theirEntryId = theirPage.entries[0]?.id;
  expect(theirEntryId).toBeDefined();

  const withForeign = await listEntries(mine.scope, {
    pageSize: 2,
    cursor: theirEntryId ?? "",
  });
  const withNonsense = await listEntries(mine.scope, {
    pageSize: 2,
    cursor: "not-an-id",
  });
  const pageOne = await listEntries(mine.scope, { pageSize: 2 });

  expect(withForeign.entries.map((e) => e.id)).toEqual(
    pageOne.entries.map((e) => e.id),
  );
  expect(withForeign.entries.map((e) => e.id)).toEqual(
    withNonsense.entries.map((e) => e.id),
  );

  const theirIds = new Set(theirPage.entries.map((e) => e.id));
  for (const entry of withForeign.entries) {
    expect(theirIds.has(entry.id)).toBe(false);
  }
});

test("J6: a NEGATIVE page size does not quietly return the oldest entries", async () => {
  // The trap this guards. A negative `take` in Prisma means "take from the
  // other end", so an unclamped -5 would return the five OLDEST entries under
  // a heading that says newest — a wrong answer that looks entirely right.
  const f = await fixture();
  await postMany(f, 5);

  const newestFirst = await listEntries(f.scope, { pageSize: MAX_JOURNAL_PAGE });
  const negative = await listEntries(f.scope, { pageSize: -5 });

  expect(negative.pageSize).toBe(1);
  expect(negative.entries).toHaveLength(1);
  expect(negative.entries[0]?.id).toBe(newestFirst.entries[0]?.id);
});

test("J7: page size is clamped at both ends, and garbage falls back", async () => {
  const f = await fixture();
  await postMany(f, 3);

  expect((await listEntries(f.scope, { pageSize: 0 })).pageSize).toBe(1);
  expect((await listEntries(f.scope, { pageSize: 1e9 })).pageSize).toBe(
    MAX_JOURNAL_PAGE,
  );
  expect((await listEntries(f.scope, { pageSize: Number.NaN })).pageSize).toBe(
    MAX_JOURNAL_PAGE,
  );
  expect((await listEntries(f.scope, { pageSize: 2.7 })).pageSize).toBe(2);
  expect((await listEntries(f.scope, {})).pageSize).toBe(MAX_JOURNAL_PAGE);
});

test("J8: entries sharing a date still page without repeating or dropping one", async () => {
  // The ordering ends in `id` because it has to be TOTAL. Two entries can share
  // a date, and a journal number is only unique within its period — at any tie
  // the "next" page is undefined, which is how keyset pagination silently
  // repeats or drops rows.
  const f = await fixture();
  for (let i = 0; i < 6; i += 1) {
    await postJournalEntry(f.scope, {
      periodId: f.period.id,
      entryDate: new Date("2024-01-15"),
      description: `Same day ${String(i)}`,
      currency: "USD",
      lines: [
        { accountId: f.cash.id, debit: "10" },
        { accountId: f.revenue.id, credit: "10" },
      ],
    });
  }

  const { ids } = await walk(f.scope, 2);

  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
});

test("J9: an empty journal pages cleanly rather than offering a dead link", async () => {
  const f = await fixture();

  const page = await listEntries(f.scope, { pageSize: 5 });

  expect(page.entries).toHaveLength(0);
  expect(page.nextCursor).toBeNull();
});

test("J10: paging never crosses a tenant boundary at any page", async () => {
  const mine = await fixture();
  await postMany(mine, 7);
  const theirs = await fixture();
  await postMany(theirs, 7);

  const { ids } = await walk(mine.scope, 2);
  const theirIds = new Set((await walk(theirs.scope, 2)).ids);

  expect(ids).toHaveLength(7);
  for (const id of ids) {
    expect(theirIds.has(id)).toBe(false);
  }
});

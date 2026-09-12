import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { ensureOrg, pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { createAccount, getAccount, listAccounts } from "../../../src/modules/ledger/accounts";
import {
  closePeriod,
  createPeriod,
  lockPeriod,
  unlockPeriod,
} from "../../../src/modules/ledger/periods";
import {
  postJournalEntry,
  reverseJournalEntry,
} from "../../../src/modules/ledger/posting";
import {
  AlreadyReversedError,
  InvalidLineError,
  NotFoundError,
  NotPostedError,
  PeriodNotOpenError,
  UnbalancedEntryError,
} from "../../../src/modules/ledger/errors";
import {
  isRetryableDbError,
  withTxUsing,
} from "../../../src/server/tx/with-tx";
import type { LedgerScope } from "../../../src/modules/ledger/scope";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function newScope(): Promise<LedgerScope> {
  const scope = unsafeCreateLedgerScope(randomUUID(), randomUUID());
  // Ledger tables now carry a real foreign key to organizations(id), so the
  // tenant has to exist before anything can be written under it.
  await ensureOrg(scope.organizationId);
  return scope;
}

/** A scope with an open period and two accounts to post between. */
async function fixture() {
  const scope = await newScope();
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

function balancedLines(cashId: string, revenueId: string, amount = "100") {
  return [
    { accountId: cashId, debit: amount },
    { accountId: revenueId, credit: amount },
  ];
}

// ── S1-S2: posting and sequential numbering ─────────────────────────

test("S1: postJournalEntry posts a balanced entry and returns journalNumber 1", async () => {
  const { scope, period, cash, revenue } = await fixture();

  const posted = await postJournalEntry(scope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  });

  expect(posted.journalNumber).toBe(1);

  const entry = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: posted.entryId },
    include: { journalLines: true },
  });
  expect(entry.postedAt).not.toBeNull();
  expect(entry.postedBy).toBe(scope.userId);
  expect(entry.journalNumber).toBe(1);
  expect(entry.journalLines).toHaveLength(2);
});

test("S2: a second post in the same period gets journalNumber 2", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const base = {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
  };

  const first = await postJournalEntry(scope, {
    ...base,
    lines: balancedLines(cash.id, revenue.id),
  });
  const second = await postJournalEntry(scope, {
    ...base,
    lines: balancedLines(cash.id, revenue.id),
  });

  expect(first.journalNumber).toBe(1);
  expect(second.journalNumber).toBe(2);
});

// ── S3-S5: validation, and that a rejected entry writes nothing ─────

test("S3: an unbalanced entry throws and persists nothing", async () => {
  const { scope, period, cash, revenue } = await fixture();

  await expect(
    postJournalEntry(scope, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Bad",
      currency: "USD",
      lines: [
        { accountId: cash.id, debit: "100" },
        { accountId: revenue.id, credit: "60" },
      ],
    }),
  ).rejects.toBeInstanceOf(UnbalancedEntryError);

  const count = await prisma.journalEntry.count({
    where: { organizationId: scope.organizationId },
  });
  expect(count).toBe(0);
});

test("S4: a single-line entry is rejected", async () => {
  const { scope, period, cash } = await fixture();
  await expect(
    postJournalEntry(scope, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Bad",
      currency: "USD",
      lines: [{ accountId: cash.id, debit: "100" }],
    }),
  ).rejects.toBeInstanceOf(InvalidLineError);
});

test("S5: a line with both debit and credit is rejected", async () => {
  const { scope, period, cash, revenue } = await fixture();
  await expect(
    postJournalEntry(scope, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Bad",
      currency: "USD",
      lines: [
        { accountId: cash.id, debit: "100", credit: "100" },
        { accountId: revenue.id, credit: "100" },
      ],
    }),
  ).rejects.toBeInstanceOf(InvalidLineError);
});

// ── S6-S7: period state ─────────────────────────────────────────────

test("S6: posting into a CLOSED period is refused", async () => {
  const { scope, period, cash, revenue } = await fixture();
  await closePeriod(scope, period.id, "month end");

  await expect(
    postJournalEntry(scope, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Late",
      currency: "USD",
      lines: balancedLines(cash.id, revenue.id),
    }),
  ).rejects.toBeInstanceOf(PeriodNotOpenError);
});

test("S7: posting into a LOCKED period is refused", async () => {
  const { scope, period, cash, revenue } = await fixture();
  await lockPeriod(scope, period.id, "audit");

  await expect(
    postJournalEntry(scope, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Late",
      currency: "USD",
      lines: balancedLines(cash.id, revenue.id),
    }),
  ).rejects.toBeInstanceOf(PeriodNotOpenError);
});

// ── S8: audit trail ─────────────────────────────────────────────────

test("S8: posting writes an audit row naming actor, org, action and entity", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const posted = await postJournalEntry(scope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  });

  const audit = await prisma.auditLog.findFirstOrThrow({
    where: {
      organizationId: scope.organizationId,
      action: "ledger.post",
      entityId: posted.entryId,
    },
  });
  expect(audit.actorId).toBe(scope.userId);
  expect(audit.entityType).toBe("JournalEntry");
});

// ── S9-S12: reversal ────────────────────────────────────────────────

test("S9: a reversal nets to zero per account against the original", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const original = await postJournalEntry(scope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id, "250.5000"),
  });

  await reverseJournalEntry(
    scope,
    original.entryId,
    new Date("2024-01-20"),
    "test reversal",
  );

  for (const accountId of [cash.id, revenue.id]) {
    const lines = await prisma.journalLine.findMany({
      where: { organizationId: scope.organizationId, accountId },
    });
    const net = lines.reduce(
      (sum, l) => sum.add(l.debit).sub(l.credit),
      new Prisma.Decimal(0),
    );
    expect(net.toString()).toBe("0");
  }
});

test("S10: a reversal links both directions", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const original = await postJournalEntry(scope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  });

  const reversal = await reverseJournalEntry(
    scope,
    original.entryId,
    new Date("2024-01-20"),
    "test reversal",
  );

  const originalRow = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: original.entryId },
  });
  const reversalRow = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: reversal.entryId },
  });
  expect(originalRow.reversedById).toBe(reversal.entryId);
  expect(reversalRow.reversalOfId).toBe(original.entryId);
  // The original must be otherwise untouched.
  expect(originalRow.description).toBe("Sale");
  expect(originalRow.journalNumber).toBe(1);
});

test("S11: reversing twice is refused", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const original = await postJournalEntry(scope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  });
  await reverseJournalEntry(
    scope,
    original.entryId,
    new Date("2024-01-20"),
    "test reversal",
  );

  await expect(
    reverseJournalEntry(
      scope,
      original.entryId,
      new Date("2024-01-21"),
      "test reversal",
    ),
  ).rejects.toBeInstanceOf(AlreadyReversedError);
});

test("S12: reversing a draft is refused", async () => {
  const { scope, period } = await fixture();
  const draft = await prisma.journalEntry.create({
    data: {
      organizationId: scope.organizationId,
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Draft",
      currency: "USD",
    },
  });

  await expect(
    reverseJournalEntry(scope, draft.id, new Date("2024-01-20")),
  ).rejects.toBeInstanceOf(NotPostedError);
});

// ── S13: tenant isolation ───────────────────────────────────────────

test("S13: accounts are org-scoped and another org's id returns null", async () => {
  const { scope, cash } = await fixture();
  const other = await newScope();

  expect(await listAccounts(other)).toHaveLength(0);
  // null, not a distinct error: a different error would confirm that some
  // other tenant holds this id.
  expect(await getAccount(other, cash.id)).toBeNull();
  expect(await getAccount(scope, cash.id)).not.toBeNull();
});

// ── S14: lock / unlock round trip is recorded ───────────────────────

test("S14: lock, unlock and relock are recorded in order in period_locks", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const entry = {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  };

  await lockPeriod(scope, period.id, "audit");
  await expect(postJournalEntry(scope, entry)).rejects.toBeInstanceOf(
    PeriodNotOpenError,
  );

  await unlockPeriod(scope, period.id, "correction approved");
  const posted = await postJournalEntry(scope, entry);
  expect(posted.journalNumber).toBe(1);

  await lockPeriod(scope, period.id, "audit resumed");

  const locks = await prisma.periodLock.findMany({
    where: { organizationId: scope.organizationId, periodId: period.id },
    orderBy: { createdAt: "asc" },
  });
  expect(locks.map((l) => l.action)).toEqual(["LOCK", "UNLOCK", "LOCK"]);
  expect(locks.map((l) => l.reason)).toEqual([
    "audit",
    "correction approved",
    "audit resumed",
  ]);
  expect(locks.every((l) => l.actorId === scope.userId)).toBe(true);
});

// ── S15: the test the counter exists for ────────────────────────────

test("S15: two concurrent posts produce numbers 1 and 2 with no gap or duplicate", async () => {
  const { scope, period, cash, revenue } = await fixture();
  const entry = {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Concurrent",
    currency: "USD",
    lines: balancedLines(cash.id, revenue.id),
  };

  const [a, b] = await Promise.all([
    postJournalEntry(scope, entry),
    postJournalEntry(scope, entry),
  ]);

  expect([a.journalNumber, b.journalNumber].sort()).toEqual([1, 2]);

  const numbers = await prisma.journalEntry.findMany({
    where: { organizationId: scope.organizationId },
    select: { journalNumber: true },
    orderBy: { journalNumber: "asc" },
  });
  expect(numbers.map((n) => n.journalNumber)).toEqual([1, 2]);
});

// ── S16-S18: the retry helper ───────────────────────────────────────

function serializationFailure(): Error & { code: string } {
  return Object.assign(new Error("could not serialize access"), {
    code: "40001",
  });
}

test("S16: withTx retries a serialization failure and then succeeds", async () => {
  let attempts = 0;
  const result = await withTxUsing(
    async () => {
      attempts += 1;
      if (attempts === 1) throw serializationFailure();
      return "ok";
    },
    async () => "unused",
    { baseDelayMs: 1 },
  );

  expect(result).toBe("ok");
  expect(attempts).toBe(2);
});

test("S17: withTx exhausts maxAttempts and throws the last error", async () => {
  let attempts = 0;
  await expect(
    withTxUsing(
      async () => {
        attempts += 1;
        throw serializationFailure();
      },
      async () => "unused",
      { maxAttempts: 3, baseDelayMs: 1 },
    ),
  ).rejects.toThrow("could not serialize access");

  expect(attempts).toBe(3);
});

test("S18: withTx does not retry a non-retryable error", async () => {
  let attempts = 0;
  const unique = Object.assign(new Error("duplicate key"), { code: "23505" });

  await expect(
    withTxUsing(
      async () => {
        attempts += 1;
        throw unique;
      },
      async () => "unused",
      { maxAttempts: 3, baseDelayMs: 1 },
    ),
  ).rejects.toThrow("duplicate key");

  expect(attempts).toBe(1);
  expect(isRetryableDbError(unique)).toBe(false);
  expect(isRetryableDbError(serializationFailure())).toBe(true);
});

// ── S19: a posting into another org's period must not be possible ───

test("S19: a period belonging to another organization is not found", async () => {
  const { period, cash, revenue } = await fixture();
  const intruder = await newScope();

  await expect(
    postJournalEntry(intruder, {
      periodId: period.id,
      entryDate: new Date("2024-01-15"),
      description: "Cross tenant",
      currency: "USD",
      lines: balancedLines(cash.id, revenue.id),
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
});

// ── S20: the blocker this migration closes ──────────────────────────

test("S20: a ledger row cannot reference an organization that does not exist", async () => {
  // Before the foreign keys landed this INSERT succeeded, which is exactly
  // what B-20260911-02 was about: the database would store a tenant id that
  // named nothing, and invariant I7 held only at the service layer.
  const orphanOrgId = randomUUID(); // deliberately never created
  const client = await pool.connect();
  try {
    await expect(
      client.query(
        `INSERT INTO accounts (id, organization_id, code, name, type, currency, is_active)
         VALUES ($1, $2, '9999', 'Orphan', 'ASSET', 'USD', true)`,
        [randomUUID(), orphanOrgId],
      ),
    ).rejects.toThrow(/foreign key/i);
  } finally {
    client.release();
  }
});

import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { resolveOrgScope } from "../../../src/server/auth/scope";
import type { OrgScope } from "../../../src/server/auth/scope";
import { ForbiddenError } from "../../../src/server/auth/errors";
import {
  guardedClosePeriod,
  guardedCreateAccount,
  guardedCreatePeriod,
  guardedListAccounts,
  guardedLockPeriod,
  guardedPostJournalEntry,
  guardedReverseJournalEntry,
  guardedUnlockPeriod,
} from "../../../src/modules/ledger/guarded";

beforeEach(async () => {
  await resetDb();
});

/** Create an organization with a known slug, plus a user holding `role` in it. */
async function actor(
  role: MembershipRole,
): Promise<{ scope: OrgScope; organizationId: string; slug: string }> {
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({
    data: { slug, name: `Test ${slug}` },
  });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, name: "T" },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role },
  });
  return {
    scope: await resolveOrgScope(user.id, org.slug),
    organizationId: org.id,
    slug: org.slug,
  };
}

/** Add another user with `role` to an organization that already exists. */
async function joinAs(
  organizationId: string,
  slug: string,
  role: MembershipRole,
): Promise<OrgScope> {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, name: "T" },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId, role },
  });
  return resolveOrgScope(user.id, slug);
}

/** A period and two accounts to post between. */
async function ledgerFixture(scope: OrgScope) {
  const period = await guardedCreatePeriod(scope, {
    name: "2024-01",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
  });
  const cash = await guardedCreateAccount(scope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });
  const revenue = await guardedCreateAccount(scope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });
  return { period, cash, revenue };
}

function entryInput(periodId: string, cashId: string, revenueId: string) {
  return {
    periodId,
    entryDate: new Date("2024-01-15"),
    description: "Sale",
    currency: "USD",
    // A line is a debit or a credit, never both, never zero.
    lines: [
      { accountId: cashId, debit: "100" },
      { accountId: revenueId, credit: "100" },
    ],
  };
}

test("G1: a BOOKKEEPER can create an account", async () => {
  const { scope } = await actor("BOOKKEEPER");
  const account = await guardedCreateAccount(scope, {
    code: "1001",
    name: "Petty cash",
    type: "ASSET",
    currency: "USD",
  });
  expect(account.code).toBe("1001");
});

test("G2: a VIEWER cannot create an account, and nothing is written", async () => {
  const { scope, organizationId } = await actor("VIEWER");

  await expect(
    guardedCreateAccount(scope, {
      code: "1002",
      name: "Nope",
      type: "ASSET",
      currency: "USD",
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);

  expect(await prisma.account.count({ where: { organizationId } })).toBe(0);
});

test("G3: a BOOKKEEPER can post a journal entry", async () => {
  const { scope } = await actor("BOOKKEEPER");
  const { period, cash, revenue } = await ledgerFixture(scope);

  const posted = await guardedPostJournalEntry(
    scope,
    entryInput(period.id, cash.id, revenue.id),
  );
  expect(posted.journalNumber).toBe(1);
});

test("G4: a VIEWER cannot post, and the WRITE never happens", async () => {
  // This is the test that matters. A gate that returns an error but still
  // writes is not a gate.
  const owner = await actor("OWNER");
  const { period, cash, revenue } = await ledgerFixture(owner.scope);
  const viewer = await joinAs(owner.organizationId, owner.slug, "VIEWER");

  await expect(
    guardedPostJournalEntry(viewer, entryInput(period.id, cash.id, revenue.id)),
  ).rejects.toBeInstanceOf(ForbiddenError);

  expect(
    await prisma.journalEntry.count({
      where: { organizationId: owner.organizationId },
    }),
  ).toBe(0);
});

test("G5: a BOOKKEEPER cannot lock a period", async () => {
  const { scope } = await actor("BOOKKEEPER");
  const { period } = await ledgerFixture(scope);

  await expect(
    guardedLockPeriod(scope, period.id, "attempted escalation"),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const row = await prisma.period.findUniqueOrThrow({ where: { id: period.id } });
  expect(row.status).toBe("OPEN");
});

test("G6: an ADMIN can lock and unlock a period", async () => {
  const { scope } = await actor("ADMIN");
  const { period } = await ledgerFixture(scope);

  await guardedLockPeriod(scope, period.id, "audit");
  expect(
    (await prisma.period.findUniqueOrThrow({ where: { id: period.id } })).status,
  ).toBe("LOCKED");

  await guardedUnlockPeriod(scope, period.id, "audit complete");
  expect(
    (await prisma.period.findUniqueOrThrow({ where: { id: period.id } })).status,
  ).toBe("OPEN");
});

test("G7: closing a period needs an ACCOUNTANT, not a BOOKKEEPER", async () => {
  const bookkeeper = await actor("BOOKKEEPER");
  const bookFixture = await ledgerFixture(bookkeeper.scope);
  await expect(
    guardedClosePeriod(bookkeeper.scope, bookFixture.period.id, "month end"),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const accountant = await actor("ACCOUNTANT");
  const acctFixture = await ledgerFixture(accountant.scope);
  await guardedClosePeriod(accountant.scope, acctFixture.period.id, "month end");
  expect(
    (
      await prisma.period.findUniqueOrThrow({
        where: { id: acctFixture.period.id },
      })
    ).status,
  ).toBe("CLOSED");
});

test("G8: a VIEWER may read accounts", async () => {
  const owner = await actor("OWNER");
  await ledgerFixture(owner.scope);
  const viewer = await joinAs(owner.organizationId, owner.slug, "VIEWER");

  const accounts = await guardedListAccounts(viewer);
  expect(accounts.map((a) => a.code)).toEqual(["1000", "4000"]);
});

test("G9: a BOOKKEEPER can reverse an entry", async () => {
  const { scope } = await actor("BOOKKEEPER");
  const { period, cash, revenue } = await ledgerFixture(scope);
  const posted = await guardedPostJournalEntry(
    scope,
    entryInput(period.id, cash.id, revenue.id),
  );

  const reversal = await guardedReverseJournalEntry(
    scope,
    posted.entryId,
    new Date("2024-01-20"),
  );

  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: posted.entryId },
  });
  expect(original.reversedById).toBe(reversal.entryId);
});

test("G10: a VIEWER cannot reverse, and the original stays unreversed", async () => {
  const owner = await actor("OWNER");
  const { period, cash, revenue } = await ledgerFixture(owner.scope);
  const posted = await guardedPostJournalEntry(
    owner.scope,
    entryInput(period.id, cash.id, revenue.id),
  );
  const viewer = await joinAs(owner.organizationId, owner.slug, "VIEWER");

  await expect(
    guardedReverseJournalEntry(viewer, posted.entryId, new Date("2024-01-20")),
  ).rejects.toBeInstanceOf(ForbiddenError);

  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: posted.entryId },
  });
  expect(original.reversedById).toBeNull();
});

import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { createPeriod } from "../../../src/modules/ledger/periods";
import { postJournalEntry } from "../../../src/modules/ledger/posting";
import { ensureOrg, resetDb } from "../../setup";
import type { LedgerScope } from "../../../src/modules/ledger/scope";
import {
  resolveOrgScope,
  assertCanDo,
  toLedgerScope,
} from "../../../src/server/auth/scope";
import type { MembershipRole } from "@prisma/client";
import {
  NotAMemberError,
  ForbiddenError,
  OrganizationNotFoundError,
} from "../../../src/server/auth/errors";

beforeEach(async () => {
  await resetDb();
});

// ── Helpers ──────────────────────────────────────────────────────────

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `u-${randomUUID()}@test.com`;
  const user = await prisma.user.create({
    data: { email, name: `User ${email}` },
  });
  return { id: user.id, email };
}

async function createOrg(slug: string): Promise<{ id: string }> {
  const org = await prisma.organization.create({
    data: { slug, name: `Test ${slug}` },
  });
  return { id: org.id };
}

async function addMembership(
  userId: string,
  organizationId: string,
  role: string,
) {
  await prisma.membership.create({
    data: { userId, organizationId, role: role as MembershipRole },
  });
}

async function getScopeForTest(userId: string, organizationSlug: string) {
  return resolveOrgScope(userId, organizationSlug);
}

// ── A1: resolveOrgScope returns the role for a real member ───────────

test("A1: resolveOrgScope returns the role for a real member", async () => {
  const user = await createUser();
  const org = await createOrg("a1-org");
  await addMembership(user.id, org.id, "BOOKKEEPER");
  await ensureOrg(org.id);

  const scope = await getScopeForTest(user.id, "a1-org");

  expect(scope.userId).toBe(user.id);
  expect(scope.organizationId).toBe(org.id);
  expect(scope.organizationSlug).toBe("a1-org");
  expect(scope.role).toBe("BOOKKEEPER");
});

// ── A2: a user with NO membership gets NotAMemberError ──────────────

test("A2: a user with no membership gets NotAMemberError", async () => {
  const user = await createUser();
  const org = await createOrg("a2-org");
  await ensureOrg(org.id);

  await expect(resolveOrgScope(user.id, "a2-org")).rejects.toBeInstanceOf(
    NotAMemberError,
  );
});

// ── A3: an unknown slug gets OrganizationNotFoundError ──────────────

test("A3: an unknown slug gets OrganizationNotFoundError", async () => {
  const user = await createUser();

  await expect(
    resolveOrgScope(user.id, "nonexistent-slug"),
  ).rejects.toBeInstanceOf(OrganizationNotFoundError);
});

// ── A4: cross-tenant — member of org A, rejected for org B ─────────

test("A4: member of org A gets NotAMemberError for org B slug", async () => {
  const user = await createUser();
  const orgA = await createOrg("a4-org-a");
  const orgB = await createOrg("a4-org-b");
  await addMembership(user.id, orgA.id, "VIEWER");
  await ensureOrg(orgA.id);
  await ensureOrg(orgB.id);

  // User is a member of orgA
  const scopeA = await getScopeForTest(user.id, "a4-org-a");
  expect(scopeA.role).toBe("VIEWER");

  // Same user should get NotAMemberError for orgB
  await expect(resolveOrgScope(user.id, "a4-org-b")).rejects.toBeInstanceOf(
    NotAMemberError,
  );
});

// ── A5-A10: assertCanDo ─────────────────────────────────────────────

test("A5: assertCanDo lets a BOOKKEEPER do ledger.post", async () => {
  const scope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "BOOKKEEPER" as MembershipRole,
  };

  expect(() => assertCanDo(scope, "ledger.post")).not.toThrow();
});

test("A6: assertCanDo refuses a VIEWER ledger.post", async () => {
  const scope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "VIEWER" as MembershipRole,
  };

  expect(() => assertCanDo(scope, "ledger.post")).toThrow(ForbiddenError);
});

test("A7: assertCanDo refuses a BOOKKEEPER ledger.period.lock", async () => {
  const scope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "BOOKKEEPER" as MembershipRole,
  };

  expect(() => assertCanDo(scope, "ledger.period.lock")).toThrow(
    ForbiddenError,
  );
});

test("A8: assertCanDo lets an ADMIN ledger.period.lock", async () => {
  const scope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "ADMIN" as MembershipRole,
  };

  expect(() => assertCanDo(scope, "ledger.period.lock")).not.toThrow();
});

test("A9: OWNER can member.remove; ADMIN cannot", async () => {
  const ownerScope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "OWNER" as MembershipRole,
  };
  const adminScope = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationSlug: "dummy",
    role: "ADMIN" as MembershipRole,
  };

  expect(() => assertCanDo(ownerScope, "member.remove")).not.toThrow();
  expect(() => assertCanDo(adminScope, "member.remove")).toThrow(
    ForbiddenError,
  );
});

// ── A10: membership revoked mid-session ─────────────────────────────

test("A10: membership revoked mid-session yields NotAMemberError", async () => {
  const user = await createUser();
  const org = await createOrg("a10-org");
  await addMembership(user.id, org.id, "BOOKKEEPER");
  await ensureOrg(org.id);

  // First resolution succeeds
  const scopeBefore = await getScopeForTest(user.id, "a10-org");
  expect(scopeBefore.role).toBe("BOOKKEEPER");

  // Revoke the membership
  await prisma.membership.deleteMany({
    where: { userId: user.id, organizationId: org.id },
  });

  // Second resolution should fail
  await expect(resolveOrgScope(user.id, "a10-org")).rejects.toBeInstanceOf(
    NotAMemberError,
  );
});

// ── A11: toLedgerScope + end-to-end posting ─────────────────────────

test("A11: toLedgerScope orgId matches and posting yields journalNumber 1", async () => {
  const user = await createUser();
  const org = await createOrg("a11-org");
  await addMembership(user.id, org.id, "BOOKKEEPER");
  await ensureOrg(org.id);

  const scope = await resolveOrgScope(user.id, "a11-org");

  // Verify toLedgerScope produces matching organizationId
  const ledgerScope = toLedgerScope(scope);
  expect(ledgerScope.organizationId).toBe(scope.organizationId);
  expect(ledgerScope.userId).toBe(scope.userId);

  // Create period and accounts through the ledger scope
  const period = await createPeriod(ledgerScope, {
    name: "2024-01",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
  });

  const cash = await createAccount(ledgerScope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });

  const revenue = await createAccount(ledgerScope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });

  // Post a journal entry
  const posted = await postJournalEntry(ledgerScope as LedgerScope, {
    periodId: period.id,
    entryDate: new Date("2024-01-15"),
    description: "Test sale",
    currency: "USD",
    lines: [
      { accountId: cash.id, debit: "100" },
      { accountId: revenue.id, credit: "100" },
    ],
  });

  expect(posted.journalNumber).toBe(1);
});

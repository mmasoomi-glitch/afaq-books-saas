import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser } from "../../../src/server/auth/session";
import { resolveOrgScope } from "../../../src/server/auth/scope";
import type { OrgScope } from "../../../src/server/auth/scope";
import { ForbiddenError } from "../../../src/server/auth/errors";
import {
  createOrganization,
  grantMembership,
} from "../../../src/server/auth/membership";
import {
  MAX_AUDIT_PAGE,
  auditActions,
  listAuditLog,
} from "../../../src/modules/audit/read";

/**
 * The audit trail, read back.
 *
 * `security-tenancy.md` requires it to be "queryable by an authorized
 * accountant for the trailing audit window". Until this module existed the only
 * way to read it was SQL, which meant the rows were being written and nobody
 * had ever confirmed they could be retrieved.
 */

const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

/** An organization whose owner has done something auditable. */
async function orgWithHistory(): Promise<{
  scope: OrgScope;
  organizationId: string;
  slug: string;
  invitedUserId: string;
}> {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const { organizationId } = await createOrganization(userId, {
    slug,
    name: "Acme",
  });
  const scope = await resolveOrgScope(userId, slug);

  const guest = newEmail();
  await registerUser(guest, PASSWORD);
  const { userId: invitedUserId } = await grantMembership(
    scope,
    guest,
    "BOOKKEEPER",
  );

  return { scope, organizationId, slug, invitedUserId };
}

/** A fresh actor holding `role` in the same organization. */
async function actorIn(
  organizationId: string,
  slug: string,
  role: MembershipRole,
): Promise<OrgScope> {
  const { userId } = await registerUser(newEmail(), PASSWORD);
  await prisma.membership.create({
    data: { userId, organizationId, role },
  });
  return resolveOrgScope(userId, slug);
}

test("A1: the membership grant that just happened is readable", async () => {
  const { scope, invitedUserId } = await orgWithHistory();

  const entries = await listAuditLog(scope);

  expect(entries.length).toBeGreaterThan(0);
  const grant = entries.find((entry) => entry.action === "member.invite");
  expect(grant).toBeDefined();
  expect(grant?.entityType).toBe("Membership");
  expect(JSON.stringify(grant?.after)).toContain(invitedUserId);
});

test("A2: the actor is resolved to an address", async () => {
  const { scope } = await orgWithHistory();

  const entries = await listAuditLog(scope);
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: scope.userId },
  });

  expect(entries[0]?.actorEmail).toBe(actor.email);
});

test("A3: a deleted actor leaves the row behind rather than hiding it", async () => {
  // Memberships cascade on user delete; audit rows do not. Showing nothing
  // would make the trail look incomplete when it is intact.
  const { scope, organizationId } = await orgWithHistory();

  // Read as somebody else, because deleting the actor would delete the scope.
  const reader = await actorIn(organizationId, scope.organizationSlug, "OWNER");
  await prisma.auditLog.updateMany({
    where: { organizationId },
    data: { actorId: reader.userId },
  });
  const orphanId = randomUUID();
  await prisma.$executeRaw`
    UPDATE audit_logs SET actor_id = ${orphanId}::uuid
    WHERE organization_id = ${organizationId}::uuid`;

  const entries = await listAuditLog(reader);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[0]?.actorEmail).toBeNull();
});

test("A4: an accountant may read it and a bookkeeper may not", async () => {
  // security-tenancy.md names the ACCOUNTANT as the person whose job this is.
  // It is not a VIEWER action: the trail carries membership grants and role
  // changes, which a bookkeeper does not need to do their work.
  const { organizationId, slug } = await orgWithHistory();

  const accountant = await actorIn(organizationId, slug, "ACCOUNTANT");
  await expect(listAuditLog(accountant)).resolves.toBeDefined();

  for (const role of ["VIEWER", "BOOKKEEPER", "APPROVER"] as const) {
    const weaker = await actorIn(organizationId, slug, role);
    await expect(listAuditLog(weaker)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(auditActions(weaker)).rejects.toBeInstanceOf(ForbiddenError);
  }
});

test("A5: one tenant never sees another tenant's trail", async () => {
  // The filter comes from the resolved scope, never from the caller. This is
  // the query whose missing WHERE clause the whole tenancy design exists to
  // prevent.
  const mine = await orgWithHistory();
  const theirs = await orgWithHistory();

  const entries = await listAuditLog(theirs.scope);

  expect(entries.length).toBeGreaterThan(0);
  const ids = new Set(entries.map((entry) => entry.id));
  const minesRows = await prisma.auditLog.findMany({
    where: { organizationId: mine.organizationId },
    select: { id: true },
  });
  for (const row of minesRows) {
    expect(ids.has(row.id)).toBe(false);
  }
});

test("A6: the page size is clamped, however large a number is asked for", async () => {
  // `limit` arrives from a query string. Unbounded, on a table that only ever
  // grows, it is a denial of service any authenticated member could trigger by
  // editing a URL.
  const { scope, organizationId } = await orgWithHistory();

  // Enough rows to exceed the cap.
  const extra = Array.from({ length: MAX_AUDIT_PAGE + 20 }, () => ({
    organizationId,
    actorId: scope.userId,
    action: "test.filler",
    entityType: "Test",
    entityId: randomUUID(),
  }));
  await prisma.auditLog.createMany({ data: extra });

  expect(await listAuditLog(scope, { limit: 100_000 })).toHaveLength(
    MAX_AUDIT_PAGE,
  );
  expect(await listAuditLog(scope, { limit: -5 })).toHaveLength(1);
  expect(await listAuditLog(scope, { limit: 0 })).toHaveLength(1);
});

test("A7: filtering by action returns only that action", async () => {
  const { scope } = await orgWithHistory();

  const filtered = await listAuditLog(scope, { action: "member.invite" });

  expect(filtered.length).toBeGreaterThan(0);
  for (const entry of filtered) {
    expect(entry.action).toBe("member.invite");
  }
});

test("A8: the action list offers only actions that exist, and only ours", async () => {
  const mine = await orgWithHistory();
  const theirs = await orgWithHistory();

  await prisma.auditLog.create({
    data: {
      organizationId: theirs.organizationId,
      actorId: theirs.scope.userId,
      action: "their.private.action",
      entityType: "Test",
      entityId: randomUUID(),
    },
  });

  const actions = await auditActions(mine.scope);

  expect(actions).toContain("member.invite");
  expect(actions).not.toContain("their.private.action");
  // Distinct, so a filter does not offer the same option twice.
  expect(new Set(actions).size).toBe(actions.length);
});

test("A9: entries come back newest first", async () => {
  const { scope } = await orgWithHistory();

  const entries = await listAuditLog(scope);

  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1]?.at.getTime() ?? 0;
    const current = entries[i]?.at.getTime() ?? 0;
    expect(previous).toBeGreaterThanOrEqual(current);
  }
});

test("A10: the trail is append-only, and reading does not change that", async () => {
  // The property the whole thing rests on. If a row could be edited, the trail
  // would be a summary of what someone currently wants to be true.
  const { scope, organizationId } = await orgWithHistory();
  const before = await listAuditLog(scope);
  const target = before[0];
  expect(target).toBeDefined();

  await expect(
    prisma.auditLog.updateMany({
      where: { organizationId },
      data: { action: "tampered" },
    }),
  ).rejects.toThrow();

  await expect(
    prisma.auditLog.deleteMany({ where: { organizationId } }),
  ).rejects.toThrow();

  const after = await listAuditLog(scope);
  expect(after.map((entry) => entry.action)).toEqual(
    before.map((entry) => entry.action),
  );
});

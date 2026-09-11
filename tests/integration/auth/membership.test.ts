import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { resolveOrgScope } from "../../../src/server/auth/scope";
import type { OrgScope } from "../../../src/server/auth/scope";
import { ForbiddenError } from "../../../src/server/auth/errors";
import {
  AlreadyAMemberError,
  CannotTransferToSelfError,
  NotAMemberOfThisOrgError,
  OwnershipTransferError,
  ROLE_RANK,
  RoleEscalationError,
  SlugTakenError,
  UserNotFoundError,
  assertGrantable,
  changeRole,
  createOrganization,
  grantMembership,
  removeMember,
  transferOwnership,
} from "../../../src/server/auth/membership";

/**
 * The property under test is that privilege only ever flows DOWNWARD, and that
 * no sequence of individually-authorised actions adds up to a takeover.
 */

const ROLES: readonly MembershipRole[] = [
  "VIEWER",
  "BOOKKEEPER",
  "APPROVER",
  "ACCOUNTANT",
  "ADMIN",
  "OWNER",
];

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

function newSlug(): string {
  return `org-${randomUUID().slice(0, 8)}`;
}

async function newUser(): Promise<{ id: string; email: string }> {
  const email = newEmail();
  const user = await prisma.user.create({ data: { email } });
  return { id: user.id, email };
}

/** An organization with `role` held by a fresh user, returned as a scope. */
async function actorIn(
  organizationId: string,
  slug: string,
  role: MembershipRole,
): Promise<OrgScope> {
  const user = await newUser();
  await prisma.membership.create({
    data: { userId: user.id, organizationId, role },
  });
  return resolveOrgScope(user.id, slug);
}

async function anOrg(): Promise<{ id: string; slug: string; owner: OrgScope }> {
  const founder = await newUser();
  const slug = newSlug();
  const { organizationId } = await createOrganization(founder.id, {
    slug,
    name: "Acme",
  });
  return {
    id: organizationId,
    slug,
    owner: await resolveOrgScope(founder.id, slug),
  };
}

test("M1: creating an organization makes the creator its OWNER", async () => {
  const founder = await newUser();
  const slug = newSlug();

  const { organizationId } = await createOrganization(founder.id, {
    slug,
    name: "Acme",
  });

  const membership = await prisma.membership.findFirstOrThrow({
    where: { organizationId, userId: founder.id },
  });
  expect(membership.role).toBe("OWNER");
});

test("M2: an organization is never created without its membership", async () => {
  // The two writes are one nested create, which Prisma runs in a transaction.
  // If they could come apart, a failure between them would leave a row nobody
  // can see, administer or delete through the product.
  const founder = await newUser();
  const slug = newSlug();
  await createOrganization(founder.id, { slug, name: "Acme" });

  await expect(
    createOrganization(founder.id, { slug, name: "Duplicate" }),
  ).rejects.toBeInstanceOf(SlugTakenError);

  // The failed attempt left nothing behind.
  expect(await prisma.organization.count({ where: { slug } })).toBe(1);
  expect(await prisma.membership.count()).toBe(1);
});

test("M3: the database refuses a malformed or reserved slug", async () => {
  // Format and reserved words are CHECK constraints, deliberately not
  // duplicated in the service — a migration or an admin script does not go
  // through it.
  const founder = await newUser();

  for (const bad of ["has space", "-leading", "trailing-", "ab", "a".repeat(41), "under_score"]) {
    await expect(
      createOrganization(founder.id, { slug: bad, name: "X" }),
    ).rejects.toThrow();
  }

  for (const reserved of ["api", "signin", "register", "admin"]) {
    await expect(
      createOrganization(founder.id, { slug: reserved, name: "X" }),
    ).rejects.toThrow();
  }
});

test("M3b: a mixed-case slug is normalised rather than refused", async () => {
  // The service lowercases before inserting, so "Acme-Books" is not an invalid
  // slug — it is a valid one written loudly. An earlier version of M3 expected
  // "UPPER" to be rejected and was wrong about the service's own behaviour.
  //
  // Normalising rather than refusing is the right call: two organizations whose
  // slugs differ only in case would be two tenants at what every user would
  // read as one address.
  const founder = await newUser();
  const slug = `Org-${randomUUID().slice(0, 8).toUpperCase()}`;

  const { slug: stored } = await createOrganization(founder.id, {
    slug,
    name: "Acme",
  });

  expect(stored).toBe(slug.toLowerCase());
  expect(await prisma.organization.count({ where: { slug: stored } })).toBe(1);
});

test("M4: the rank order is the one the rules assume", async () => {
  const ranks = ROLES.map((r) => ROLE_RANK[r]);
  expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
});

test("M5: OWNER is never grantable, by anyone, including an OWNER", async () => {
  // Promoting a co-owner and transferring ownership are different intentions.
  // They should not share a code path or an audit entry.
  for (const granter of ROLES) {
    expect(() => {
      assertGrantable(granter, "OWNER");
    }).toThrow(OwnershipTransferError);
  }
});

test("M6: a role may only be granted strictly below the granter's own", async () => {
  // The exhaustive statement of the rule. Every pair, both directions.
  for (const granter of ROLES) {
    for (const target of ROLES) {
      if (target === "OWNER") continue; // covered by M5
      const allowed = ROLE_RANK[target] < ROLE_RANK[granter];
      if (allowed) {
        expect(() => {
          assertGrantable(granter, target);
        }).not.toThrow();
      } else {
        expect(() => {
          assertGrantable(granter, target);
        }).toThrow(RoleEscalationError);
      }
    }
  }
});

test("M7: an ADMIN cannot mint another ADMIN", async () => {
  // "At or below" would allow this, and it makes the ADMIN boundary
  // unenforceable by headcount: one admin can always create an accomplice with
  // every power they have.
  const org = await anOrg();
  const admin = await actorIn(org.id, org.slug, "ADMIN");
  const target = await newUser();

  await expect(
    grantMembership(admin, target.email, "ADMIN"),
  ).rejects.toBeInstanceOf(RoleEscalationError);

  expect(await prisma.membership.count({ where: { userId: target.id } })).toBe(0);
});

test("M8: two ADMINs cannot escalate each other", async () => {
  // The reason a self-targeting rule is not sufficient. Neither admin ever
  // targets themselves, and without the rank check both become OWNER.
  const org = await anOrg();
  const a = await actorIn(org.id, org.slug, "ADMIN");
  const b = await actorIn(org.id, org.slug, "ADMIN");

  await expect(changeRole(a, b.userId, "OWNER")).rejects.toBeInstanceOf(
    OwnershipTransferError,
  );
  await expect(changeRole(b, a.userId, "ADMIN")).rejects.toBeInstanceOf(
    RoleEscalationError,
  );

  for (const userId of [a.userId, b.userId]) {
    const m = await prisma.membership.findFirstOrThrow({
      where: { userId, organizationId: org.id },
    });
    expect(m.role).toBe("ADMIN");
  }
});

test("M9: an ADMIN cannot reach up to DEMOTE an OWNER", async () => {
  // The same takeover by a different route, and arguably the faster one. If you
  // cannot promote above yourself, you must not be able to demote above
  // yourself either.
  const org = await anOrg();
  const admin = await actorIn(org.id, org.slug, "ADMIN");

  await expect(
    changeRole(admin, org.owner.userId, "VIEWER"),
  ).rejects.toBeInstanceOf(RoleEscalationError);

  const owner = await prisma.membership.findFirstOrThrow({
    where: { userId: org.owner.userId, organizationId: org.id },
  });
  expect(owner.role).toBe("OWNER");
});

test("M10: nobody can change their own role through this path", async () => {
  // A consequence of comparing the target's CURRENT role against the granter's:
  // they are equal when the target is the granter. An owner who wants to step
  // down transfers ownership rather than demoting themselves as a side effect.
  const org = await anOrg();

  await expect(
    changeRole(org.owner, org.owner.userId, "VIEWER"),
  ).rejects.toBeInstanceOf(RoleEscalationError);
});

test("M11: an OWNER can grant every role below OWNER, and it takes effect", async () => {
  const org = await anOrg();

  for (const role of ROLES.filter((r) => r !== "OWNER")) {
    const target = await newUser();
    const { userId } = await grantMembership(org.owner, target.email, role);

    const m = await prisma.membership.findFirstOrThrow({
      where: { userId, organizationId: org.id },
    });
    expect(m.role).toBe(role);
  }
});

test("M12: a role a caller has no permission to touch is refused first", async () => {
  // Permission BEFORE escalation. Reversed, "a VIEWER may not grant ADMIN"
  // would confirm to an unauthorised caller that ADMIN exists and where it
  // sits in the order.
  const org = await anOrg();
  const viewer = await actorIn(org.id, org.slug, "VIEWER");
  const target = await newUser();

  await expect(
    grantMembership(viewer, target.email, "VIEWER"),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("M13: only an OWNER may remove a member", async () => {
  const org = await anOrg();
  const admin = await actorIn(org.id, org.slug, "ADMIN");
  const victim = await actorIn(org.id, org.slug, "VIEWER");

  await expect(removeMember(admin, victim.userId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  await removeMember(org.owner, victim.userId);
  expect(
    await prisma.membership.count({ where: { userId: victim.userId } }),
  ).toBe(0);
});

test("M14: the database refuses to leave an organization without an OWNER", async () => {
  // Enforced by a DEFERRABLE trigger rather than a count taken in the service.
  // A check-then-act races: two concurrent demotions each read two owners, each
  // conclude they are safe, and the organization ends with none.
  const org = await anOrg();

  await expect(removeMember(org.owner, org.owner.userId)).rejects.toThrow();

  const owners = await prisma.membership.count({
    where: { organizationId: org.id, role: "OWNER" },
  });
  expect(owners).toBe(1);
});

test("M15: a second OWNER may be removed, because one remains", async () => {
  // The trigger must not be a blanket ban on touching owners — only on
  // reaching zero.
  const org = await anOrg();
  const second = await actorIn(org.id, org.slug, "OWNER");

  await removeMember(org.owner, second.userId);

  expect(
    await prisma.membership.count({
      where: { organizationId: org.id, role: "OWNER" },
    }),
  ).toBe(1);
});

test("M16: granting to an unknown address does not create anything", async () => {
  const org = await anOrg();

  await expect(
    grantMembership(org.owner, newEmail(), "VIEWER"),
  ).rejects.toBeInstanceOf(UserNotFoundError);

  expect(await prisma.membership.count({ where: { organizationId: org.id } })).toBe(1);
});

test("M17: granting twice is refused rather than duplicated", async () => {
  const org = await anOrg();
  const target = await newUser();

  await grantMembership(org.owner, target.email, "VIEWER");
  await expect(
    grantMembership(org.owner, target.email, "BOOKKEEPER"),
  ).rejects.toBeInstanceOf(AlreadyAMemberError);

  expect(await prisma.membership.count({ where: { userId: target.id } })).toBe(1);
});

test("M18: an address is matched case-insensitively when granting", async () => {
  const org = await anOrg();
  const email = `Mixed.${randomUUID()}@Example.Test`;
  const user = await prisma.user.create({
    data: { email: email.toLowerCase() },
  });

  const { userId } = await grantMembership(org.owner, email, "VIEWER");
  expect(userId).toBe(user.id);
});

test("M19: administration never reaches another organization's members", async () => {
  // The target is looked up by (userId, organizationId), so a user id from
  // elsewhere is simply not a member here — not a 403 that confirms they exist.
  const a = await anOrg();
  const b = await anOrg();

  await expect(
    changeRole(a.owner, b.owner.userId, "VIEWER"),
  ).rejects.toBeInstanceOf(NotAMemberOfThisOrgError);

  await expect(
    removeMember(a.owner, b.owner.userId),
  ).rejects.toBeInstanceOf(NotAMemberOfThisOrgError);

  const untouched = await prisma.membership.findFirstOrThrow({
    where: { userId: b.owner.userId, organizationId: b.id },
  });
  expect(untouched.role).toBe("OWNER");
});

test("M20: a demotion an OWNER is entitled to make takes effect", async () => {
  const org = await anOrg();
  const accountant = await actorIn(org.id, org.slug, "ACCOUNTANT");

  await changeRole(org.owner, accountant.userId, "VIEWER");

  const m = await prisma.membership.findFirstOrThrow({
    where: { userId: accountant.userId, organizationId: org.id },
  });
  expect(m.role).toBe("VIEWER");
});

test("M21: an organization that never had an OWNER is not frozen", async () => {
  // Found by the trigger breaking four unrelated tests.
  //
  // The first version fired whenever the owner count was zero AFTER the
  // statement, which meant an organization that never had an owner could never
  // have a membership removed at all — the error would report a state that was
  // already true before the statement ran. Any organization created outside
  // `createOrganization` (a migration, a seed, a fixture) would be frozen.
  //
  // Only removing or demoting an OWNER can take the count to zero, so that is
  // the only case the trigger examines.
  const org = await prisma.organization.create({
    data: { slug: newSlug(), name: "Ownerless" },
  });
  const user = await newUser();
  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: "BOOKKEEPER" },
  });

  await prisma.membership.deleteMany({
    where: { userId: user.id, organizationId: org.id },
  });

  expect(
    await prisma.membership.count({ where: { organizationId: org.id } }),
  ).toBe(0);
});

test("M22: demoting the last OWNER is refused as well as removing them", async () => {
  // The trigger fires on UPDATE as well as DELETE. Without that half, the
  // takeover is a one-line change of route: demote the only owner to VIEWER
  // instead of deleting them.
  const org = await anOrg();

  await expect(
    prisma.membership.updateMany({
      where: { organizationId: org.id, role: "OWNER" },
      data: { role: "VIEWER" },
    }),
  ).rejects.toThrow();

  const owner = await prisma.membership.findFirstOrThrow({
    where: { organizationId: org.id, userId: org.owner.userId },
  });
  expect(owner.role).toBe("OWNER");
});

test("M23: ownership can be handed over in one transaction", async () => {
  // The reason the trigger is DEFERRABLE. A handover promotes one member and
  // demotes another, and there is an instant between the two statements when
  // the count is zero. A per-statement check would make the operation possible
  // in one order and impossible in the other, which is an arbitrary rule nobody
  // would guess.
  const org = await anOrg();
  const successor = await actorIn(org.id, org.slug, "ADMIN");

  await prisma.$transaction(async (tx) => {
    // Deliberately the "wrong" order: demote first, so the count passes
    // through zero.
    await tx.membership.updateMany({
      where: { organizationId: org.id, userId: org.owner.userId },
      data: { role: "ADMIN" },
    });
    await tx.membership.updateMany({
      where: { organizationId: org.id, userId: successor.userId },
      data: { role: "OWNER" },
    });
  });

  const owners = await prisma.membership.findMany({
    where: { organizationId: org.id, role: "OWNER" },
  });
  expect(owners).toHaveLength(1);
  expect(owners[0]?.userId).toBe(successor.userId);
});

/** The audit rows written for one organization, oldest first. */
async function auditRows(organizationId: string) {
  return prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
}

test("M24: granting a membership writes an audit row in the same transaction", async () => {
  // accounting-integrity.md I9 lists role grant among the actions that MUST be
  // recorded. An audit entry committed separately is the entry that turns out
  // to be missing for the one change anybody ever asks about.
  const org = await anOrg();
  const target = await newUser();

  await grantMembership(org.owner, target.email, "BOOKKEEPER");

  const row = (await auditRows(org.id)).at(-1);
  expect(row?.action).toBe("member.invite");
  expect(row?.entityType).toBe("Membership");
  expect(row?.actorId).toBe(org.owner.userId);
  expect(row?.after).toEqual({ userId: target.id, role: "BOOKKEEPER" });
});

test("M25: a role change records what the role was, not only what it became", async () => {
  // "Who is an ADMIN now" is answerable from the memberships table. "Who made
  // them one, and what were they before" is only answerable from here.
  const org = await anOrg();
  const member = await actorIn(org.id, org.slug, "VIEWER");

  await changeRole(org.owner, member.userId, "ACCOUNTANT");

  const row = (await auditRows(org.id)).at(-1);
  expect(row?.action).toBe("role.grant");
  expect(row?.before).toEqual({ userId: member.userId, role: "VIEWER" });
  expect(row?.after).toEqual({ userId: member.userId, role: "ACCOUNTANT" });
});

test("M26: removing a member leaves the only record that they were one", async () => {
  const org = await anOrg();
  const member = await actorIn(org.id, org.slug, "APPROVER");

  await removeMember(org.owner, member.userId);

  const row = (await auditRows(org.id)).at(-1);
  expect(row?.action).toBe("member.remove");
  expect(row?.before).toEqual({ userId: member.userId, role: "APPROVER" });
  expect(
    await prisma.membership.count({ where: { userId: member.userId } }),
  ).toBe(0);
});

test("M27: a failed membership change writes no audit row", async () => {
  // The pair is one transaction, so a rollback must take the audit entry with
  // it. An audit log containing changes that did not happen is worse than one
  // missing changes that did: it is evidence of something untrue.
  const org = await anOrg();
  const admin = await actorIn(org.id, org.slug, "ADMIN");
  const before = (await auditRows(org.id)).length;

  await expect(
    changeRole(admin, org.owner.userId, "VIEWER"),
  ).rejects.toBeInstanceOf(RoleEscalationError);

  expect((await auditRows(org.id)).length).toBe(before);
});

test("M28: an OWNER can hand the organization over", async () => {
  // The gap the escalation rule opened: assertGrantable refuses OWNER from
  // everyone, changeRole will not touch a role at or above the caller own,
  // and the trigger refuses to remove the last owner. Without this action the
  // founder was owner permanently.
  const org = await anOrg();
  const successor = await actorIn(org.id, org.slug, "ADMIN");

  await transferOwnership(org.owner, successor.userId);

  const owners = await prisma.membership.findMany({
    where: { organizationId: org.id, role: "OWNER" },
  });
  expect(owners).toHaveLength(1);
  expect(owners[0]?.userId).toBe(successor.userId);

  // The outgoing owner keeps a foothold rather than being locked out.
  const outgoing = await prisma.membership.findFirstOrThrow({
    where: { organizationId: org.id, userId: org.owner.userId },
  });
  expect(outgoing.role).toBe("ADMIN");
});

test("M29: the handover is audited as a transfer, not as a role change", async () => {
  const org = await anOrg();
  const successor = await actorIn(org.id, org.slug, "ADMIN");

  await transferOwnership(org.owner, successor.userId);

  const row = (await auditRows(org.id)).at(-1);
  expect(row?.action).toBe("ownership.transfer");
  expect(row?.actorId).toBe(org.owner.userId);
});

test("M30: nobody below OWNER can transfer ownership", async () => {
  const org = await anOrg();
  const admin = await actorIn(org.id, org.slug, "ADMIN");
  const target = await actorIn(org.id, org.slug, "VIEWER");

  await expect(transferOwnership(admin, target.userId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  expect(
    await prisma.membership.count({
      where: { organizationId: org.id, role: "OWNER" },
    }),
  ).toBe(1);
});

test("M31: ownership cannot be transferred to yourself or to a non-member", async () => {
  const org = await anOrg();
  const outsider = await newUser();

  await expect(
    transferOwnership(org.owner, org.owner.userId),
  ).rejects.toBeInstanceOf(CannotTransferToSelfError);

  await expect(
    transferOwnership(org.owner, outsider.id),
  ).rejects.toBeInstanceOf(NotAMemberOfThisOrgError);
});

test("M32: a transfer never leaves two owners or none", async () => {
  // The promotion and demotion pass through zero owners in between, which is
  // why the trigger is DEFERRABLE. Checked per statement, this would be
  // possible in one order and not the other.
  const org = await anOrg();
  const first = await actorIn(org.id, org.slug, "ADMIN");
  const second = await actorIn(org.id, org.slug, "ADMIN");

  await transferOwnership(org.owner, first.userId);
  const afterFirst = await resolveOrgScope(first.userId, org.slug);
  await transferOwnership(afterFirst, second.userId);

  const owners = await prisma.membership.findMany({
    where: { organizationId: org.id, role: "OWNER" },
  });
  expect(owners).toHaveLength(1);
  expect(owners[0]?.userId).toBe(second.userId);
});

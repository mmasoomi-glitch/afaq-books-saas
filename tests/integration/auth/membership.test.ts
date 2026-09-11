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

  for (const bad of ["UPPER", "has space", "-leading", "trailing-", "ab", "a".repeat(41)]) {
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

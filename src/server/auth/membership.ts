import type { MembershipRole } from "@prisma/client";
import { prisma } from "../db/client";
import type { OrgScope } from "./scope";
import { assertCanDo } from "./scope";
import { AuthError } from "./errors";
import { normaliseEmail } from "./session";

/**
 * Organization creation and membership administration.
 *
 * Every function except `createOrganization` takes an already-resolved
 * `OrgScope`, so membership in the organization being administered has been
 * proven by `resolveOrgScope` before any of this runs. Nothing here re-checks
 * that, and nothing here should be called with a scope assembled by hand.
 */

export const ROLE_RANK: Readonly<Record<MembershipRole, number>> = Object.freeze(
  { VIEWER: 0, BOOKKEEPER: 1, APPROVER: 2, ACCOUNTANT: 3, ADMIN: 4, OWNER: 5 },
);

export class RoleEscalationError extends AuthError {
  constructor(granterRole: MembershipRole, targetRole: MembershipRole) {
    super(`a ${granterRole} may not grant ${targetRole}`, "AUTH_ROLE_ESCALATION");
    this.name = "RoleEscalationError";
  }
}

export class OwnershipTransferError extends AuthError {
  constructor() {
    super("ownership is transferred, not granted", "AUTH_OWNERSHIP_NOT_GRANTABLE");
    this.name = "OwnershipTransferError";
  }
}

export class UserNotFoundError extends AuthError {
  constructor() {
    super("no such user", "AUTH_USER_NOT_FOUND");
    this.name = "UserNotFoundError";
  }
}

export class AlreadyAMemberError extends AuthError {
  constructor() {
    super("that user is already a member", "AUTH_ALREADY_MEMBER");
    this.name = "AlreadyAMemberError";
  }
}

export class NotAMemberOfThisOrgError extends AuthError {
  constructor() {
    super("that user is not a member", "AUTH_TARGET_NOT_MEMBER");
    this.name = "NotAMemberOfThisOrgError";
  }
}

export class SlugTakenError extends AuthError {
  constructor() {
    super("that address is already in use", "ORG_SLUG_TAKEN");
    this.name = "SlugTakenError";
  }
}

export class CannotTransferToSelfError extends AuthError {
  constructor() {
    super("you already own this organization", "AUTH_ALREADY_OWNER");
    this.name = "CannotTransferToSelfError";
  }
}

/** Narrowed, not cast: a thrown value is `unknown` and may be anything. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * A granter may assign a role STRICTLY BELOW their own, and never OWNER.
 *
 * The attack this closes is concrete. With an unconstrained `role.grant`, an
 * ADMIN grants OWNER to themselves or to an accomplice, and that OWNER removes
 * the real owner. In an accounting product the new owner can then lock periods,
 * post adjusting entries and export everything — the takeover is complete and
 * every step of it was an authorised action.
 *
 * "You may not target YOURSELF" is the tempting wrong answer. It reads as
 * though it closes the loop and it does not: two ADMINs simply escalate each
 * other, A promotes B and B promotes A, and nothing in a self-check notices
 * because neither of them ever targeted themselves.
 *
 * "Strictly below" rather than "at or below" for a related reason. An ADMIN who
 * can mint another ADMIN can mint an accomplice holding every power they hold,
 * which makes the ADMIN boundary unenforceable by headcount — you can never
 * reduce the number of administrators below the number any one of them chooses.
 *
 * OWNER is excluded entirely rather than being reachable by another OWNER,
 * because promoting someone to co-owner and transferring ownership are
 * different intentions and should not share a code path or an audit entry.
 * Decided by independent review, which chose this over the weaker variants.
 */
export function assertGrantable(
  granterRole: MembershipRole,
  targetRole: MembershipRole,
): void {
  if (targetRole === "OWNER") {
    throw new OwnershipTransferError();
  }
  if (ROLE_RANK[targetRole] >= ROLE_RANK[granterRole]) {
    throw new RoleEscalationError(granterRole, targetRole);
  }
}

export async function createOrganization(
  userId: string,
  input: { slug: string; name: string },
): Promise<{ organizationId: string; slug: string }> {
  const slug = input.slug.trim().toLowerCase();

  try {
    // A nested create, which Prisma executes as ONE transaction — the
    // atomicity here is real and not decorative. It matters because an
    // organization with no membership is unreachable by anyone, including the
    // person who just created it: a failure between the two statements would
    // leave a row nobody can see, administer or delete through the product.
    const organization = await prisma.organization.create({
      data: {
        slug,
        name: input.name,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: { id: true, slug: true },
    });

    return { organizationId: organization.id, slug: organization.slug };
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError();

    // The slug FORMAT and reserved-word rules are database `CHECK` constraints
    // and are deliberately not duplicated here. Two copies of a rule drift, and
    // the database's copy is the one that actually holds — a migration or an
    // admin script does not go through this function.
    throw error;
  }
}

export async function grantMembership(
  scope: OrgScope,
  targetEmail: string,
  role: MembershipRole,
): Promise<{ userId: string }> {
  // Permission BEFORE escalation, and the order is the point: a caller with no
  // permission at all must not learn from the error which roles are grantable.
  // Reversed, "a VIEWER may not grant ADMIN" would confirm to an unauthorised
  // caller that ADMIN exists and where it sits.
  assertCanDo(scope, "member.invite");
  assertGrantable(scope.role, role);

  // This DOES reveal whether an address has an account. The disclosure is real
  // and is accepted here because the audience is already narrow — the caller is
  // authenticated and holds `member.invite` in this organization. An
  // invite-by-token flow, where the address is emailed rather than looked up,
  // would avoid it entirely and is the better design when there is a mailer.
  const user = await prisma.user.findUnique({
    where: { email: normaliseEmail(targetEmail) },
    select: { id: true },
  });

  if (user === null) throw new UserNotFoundError();

  try {
    // The membership and its audit row are ONE transaction. An audit entry
    // committed separately is the entry that turns out to be missing for the
    // one change anybody ever asks about — and `accounting-integrity.md` I9
    // lists role grant among the actions that must be recorded, not among the
    // ones that should be.
    await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: { organizationId: scope.organizationId, userId: user.id, role },
      });
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: "member.invite",
          entityType: "Membership",
          entityId: membership.id,
          after: { userId: user.id, role },
        },
      });
    });
    return { userId: user.id };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AlreadyAMemberError();
    throw error;
  }
}

export async function changeRole(
  scope: OrgScope,
  targetUserId: string,
  role: MembershipRole,
): Promise<void> {
  assertCanDo(scope, "role.grant");
  assertGrantable(scope.role, role);

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: targetUserId,
        organizationId: scope.organizationId,
      },
    },
    select: { id: true, role: true },
  });

  if (membership === null) throw new NotAMemberOfThisOrgError();

  // The other half of the escalation rule, and it is easy to miss.
  //
  // `assertGrantable` stops an ADMIN promoting anyone TO admin or above. It
  // does nothing about an ADMIN reaching UP to demote an existing OWNER to
  // VIEWER — which is the same takeover by a different route, and arguably a
  // faster one. If you cannot promote above yourself, you must not be able to
  // reach above yourself to demote either.
  //
  // The `>=` also means nobody can change their OWN role through this path:
  // their current role always equals their granter role. That is deliberate.
  // An owner who wants to step down transfers ownership; that is a separate,
  // named action rather than a side effect of a general role change.
  if (ROLE_RANK[membership.role] >= ROLE_RANK[scope.role]) {
    throw new RoleEscalationError(scope.role, membership.role);
  }

  // What stops the LAST owner being demoted is the database trigger
  // `memberships_require_owner`, not a count taken here. A check-then-act in
  // application code races: two concurrent demotions each read two owners,
  // each conclude they are safe, and the organization ends with none. The
  // trigger is DEFERRABLE and evaluated at COMMIT, which is the only point at
  // which the question has a stable answer.
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membership.id }, data: { role } });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "role.grant",
        entityType: "Membership",
        entityId: membership.id,
        // BEFORE as well as after. "Who is an ADMIN now" is answerable from the
        // table; "who made them one, and what were they before" is only
        // answerable from here.
        before: { userId: targetUserId, role: membership.role },
        after: { userId: targetUserId, role },
      },
    });
  });
}

export async function removeMember(
  scope: OrgScope,
  targetUserId: string,
): Promise<void> {
  assertCanDo(scope, "member.remove");

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: targetUserId,
        organizationId: scope.organizationId,
      },
    },
    // `role` is selected because the audit row needs it, and this is the last
    // moment it exists anywhere: once the row is deleted, `before` is the only
    // record of what the removed member was allowed to do.
    select: { id: true, role: true },
  });

  if (membership === null) throw new NotAMemberOfThisOrgError();

  // Removing the last OWNER is refused by the trigger, for the same race
  // reason as above. `member.remove` is OWNER-only, so the common case of this
  // failing is an owner removing themselves while being the only one.
  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: membership.id } });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "member.remove",
        entityType: "Membership",
        entityId: membership.id,
        // The row is gone, so `before` is the only record that it existed at
        // all, and the only place the removed member's role survives.
        before: { userId: targetUserId, role: membership.role },
      },
    });
  });
}

/**
 * Hand an organization over. OWNER-only, and the only route to the OWNER role.
 *
 * This exists because `assertGrantable` refuses OWNER from every caller, which
 * on its own left an owner unable to step down at all: `changeRole` will not
 * touch a role at or above the caller's own — including their own — and the
 * database trigger refuses to remove the last owner. Both refusals are correct
 * individually; together they made the founder owner permanently.
 *
 * Promotion and demotion happen in ONE transaction, in the order that passes
 * through zero owners, precisely to prove that the `DEFERRABLE` trigger permits
 * it. A per-statement check would make this expressible in one order and not
 * the other, which is an arbitrary rule nobody would guess.
 *
 * It is its own action key rather than a role change, so the audit trail can
 * say which of the two intentions happened. That separation was the entire
 * argument for excluding OWNER from `role.grant`; reaching the same state by a
 * generic path would have given the argument away.
 */
export async function transferOwnership(
  scope: OrgScope,
  targetUserId: string,
): Promise<void> {
  assertCanDo(scope, "ownership.transfer");

  if (targetUserId === scope.userId) throw new CannotTransferToSelfError();

  const target = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: targetUserId,
        organizationId: scope.organizationId,
      },
    },
    select: { id: true, role: true },
  });

  if (target === null) throw new NotAMemberOfThisOrgError();

  const outgoing = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: scope.userId,
        organizationId: scope.organizationId,
      },
    },
    select: { id: true },
  });

  // The scope was resolved from a real membership row, so this cannot be null
  // in practice. It is checked rather than asserted because "cannot happen"
  // and "does not happen" are different claims, and the cost of being wrong
  // here is an organization with two owners or none.
  if (outgoing === null) throw new NotAMemberOfThisOrgError();

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: outgoing.id },
      data: { role: "ADMIN" },
    });
    await tx.membership.update({
      where: { id: target.id },
      data: { role: "OWNER" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ownership.transfer",
        entityType: "Membership",
        entityId: target.id,
        before: { ownerUserId: scope.userId, targetRole: target.role },
        after: { ownerUserId: targetUserId, outgoingRole: "ADMIN" },
      },
    });
  });
}

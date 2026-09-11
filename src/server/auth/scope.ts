import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import type { LedgerScope } from "../../modules/ledger/scope.js";
import { unsafeCreateLedgerScope } from "../../modules/ledger/scope.js";
import { NotAMemberError, ForbiddenError, OrganizationNotFoundError } from "./errors.js";
import type { Action } from "./permissions.js";
import { can } from "./permissions.js";

/**
 * A resolved, membership-verified scope.
 *
 * NOT branded, unlike LedgerScope, and that is a deliberate and reviewed
 * choice rather than an omission. `resolveOrgScope` is the only thing that
 * produces one today, so a forged literal has nowhere to enter from.
 *
 * The risk if that stops being true: this type is forgeable, and a fabricated
 * `{ userId, organizationId, organizationSlug, role: "OWNER" }` passed to
 * `assertCanDo` would be approved for everything. The independent reviewer was
 * asked directly and judged it "acceptable for now as resolveOrgScope is the
 * sole producer", with the condition below.
 *
 * TODO(B-20260911-05): brand OrgScope the moment a SECOND producer appears —
 * an Auth.js adapter, a service-account path, a test helper that mints one
 * outside resolveOrgScope. The trigger is a new producer, not a date.
 */
export interface OrgScope {
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly role: MembershipRole;
}

export async function resolveOrgScope(
  userId: string,
  organizationSlug: string,
): Promise<OrgScope> {
  const org = await prisma.organization.findFirst({
    where: { slug: organizationSlug },
    select: { id: true, slug: true },
  });

  if (org === null) {
    throw new OrganizationNotFoundError();
  }

  const membership = await prisma.membership.findFirst({
    where: { userId, organizationId: org.id },
    select: { role: true },
  });

  if (membership === null) {
    throw new NotAMemberError();
  }

  return {
    userId,
    organizationId: org.id,
    organizationSlug: org.slug,
    role: membership.role as MembershipRole,
  };
}

export function assertCanDo(scope: OrgScope, action: Action): void {
  if (!can(scope.role, action)) {
    throw new ForbiddenError(action, scope.role);
  }
}

/**
 * Narrow a verified OrgScope to the LedgerScope the ledger services accept.
 *
 * This is the legitimate bridge: by the time an OrgScope exists,
 * resolveOrgScope has confirmed a real Membership row, and the guarded wrappers
 * have asserted the action. Minting the brand here is the assertion that both
 * happened.
 */
export function toLedgerScope(scope: OrgScope): LedgerScope {
  return unsafeCreateLedgerScope(scope.userId, scope.organizationId);
}

import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import type { LedgerScope } from "../../modules/ledger/scope.js";
import { NotAMemberError, ForbiddenError, OrganizationNotFoundError } from "./errors.js";
import type { Action } from "./permissions.js";
import { can } from "./permissions.js";

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

export function toLedgerScope(scope: OrgScope): LedgerScope {
  return {
    userId: scope.userId,
    organizationId: scope.organizationId,
  };
}

import { toRouteHandler } from "../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../server/http/handlers/scoped";
import {
  changeRoleHandler,
  removeMemberHandler,
} from "../../../../../../server/http/handlers/organizations";

/**
 * Both the organization and the target user come from the URL. Neither is read
 * from the body, so a caller cannot name one organization in the path and
 * another in the payload and hope the two are checked in different places.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; userId: string }> },
): Promise<Response> {
  const { orgSlug, userId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, changeRoleHandler(userId)),
    adapterConfig(),
  )(request);
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; userId: string }> },
): Promise<Response> {
  const { orgSlug, userId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, removeMemberHandler(userId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

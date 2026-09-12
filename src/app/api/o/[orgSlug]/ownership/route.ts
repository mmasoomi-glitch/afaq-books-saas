import { toRouteHandler } from "../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../server/http/config";
import { withOrgScope } from "../../../../../server/http/handlers/scoped";
import { transferOwnershipHandler } from "../../../../../server/http/handlers/organizations";

/**
 * Its own route rather than a role change on a member, because handing over an
 * organization and adjusting someone's permissions are different intentions.
 * That separation is the whole reason `assertGrantable` refuses OWNER from
 * every caller, and collapsing it into `PATCH /members/[userId]` would give the
 * argument away.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, transferOwnershipHandler()),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

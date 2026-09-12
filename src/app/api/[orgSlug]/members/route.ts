import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import { grantMemberHandler } from "../../../../server/http/handlers/organizations";

/**
 * The org slug comes from the URL and is passed to `withOrgScope`, which
 * re-resolves the caller's membership in it before the handler runs. It is
 * never read from the body: `.claude/rules/security-tenancy.md` is explicit
 * that the accepted input for an organization is the URL segment, mapped
 * server-side through a membership-verified lookup.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, grantMemberHandler()),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

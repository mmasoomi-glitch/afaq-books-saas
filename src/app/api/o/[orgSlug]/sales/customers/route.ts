import { toRouteHandler } from "../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../server/http/handlers/scoped";
import { createCustomerHandler } from "../../../../../../server/http/handlers/sales";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, createCustomerHandler()),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

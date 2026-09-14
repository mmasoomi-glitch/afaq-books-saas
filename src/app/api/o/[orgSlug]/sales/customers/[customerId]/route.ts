import { toRouteHandler } from "../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../server/http/handlers/scoped";
import {
  getCustomerHandler,
  updateCustomerHandler,
  deactivateCustomerHandler,
} from "../../../../../../../server/http/handlers/sales";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; customerId: string }> },
): Promise<Response> {
  const { orgSlug, customerId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, getCustomerHandler(customerId)),
    adapterConfig(),
  )(request);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; customerId: string }> },
): Promise<Response> {
  const { orgSlug, customerId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, updateCustomerHandler(customerId)),
    adapterConfig(),
  )(request);
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; customerId: string }> },
): Promise<Response> {
  const { orgSlug, customerId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, deactivateCustomerHandler(customerId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { toRouteHandler } from "../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../server/http/handlers/scoped";
import {
  applyPaymentHandler,
  unapplyPaymentHandler,
} from "../../../../../../../server/http/handlers/sales";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; paymentId: string }> },
): Promise<Response> {
  const { orgSlug, paymentId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, applyPaymentHandler(paymentId)),
    adapterConfig(),
  )(request);
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; paymentId: string }> },
): Promise<Response> {
  const { orgSlug, paymentId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, unapplyPaymentHandler(paymentId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

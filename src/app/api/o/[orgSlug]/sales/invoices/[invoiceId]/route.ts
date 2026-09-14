import { toRouteHandler } from "../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../server/http/handlers/scoped";
import {
  getInvoiceHandler,
  cancelInvoiceHandler,
  voidInvoiceHandler,
} from "../../../../../../../server/http/handlers/sales";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; invoiceId: string }> },
): Promise<Response> {
  const { orgSlug, invoiceId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, getInvoiceHandler(invoiceId)),
    adapterConfig(),
  )(request);
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; invoiceId: string }> },
): Promise<Response> {
  const { orgSlug, invoiceId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, voidInvoiceHandler(invoiceId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { toRouteHandler } from "../../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../../server/http/handlers/scoped";
import {
  applyCreditNoteHandler,
} from "../../../../../../../../server/http/handlers/sales";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; creditNoteId: string }> },
): Promise<Response> {
  const { orgSlug, creditNoteId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, applyCreditNoteHandler(creditNoteId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { toRouteHandler } from "../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../server/http/handlers/scoped";
import { reverseEntryHandler } from "../../../../../../../server/http/handlers/ledger";

/**
 * Its own route under the entry it reverses, so the thing being corrected is
 * named in the URL and cannot be supplied by the body. A caller therefore
 * cannot pass the authorization checks for one entry and reverse another.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; entryId: string }> },
): Promise<Response> {
  const { orgSlug, entryId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, reverseEntryHandler(entryId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

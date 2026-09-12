import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import { postEntryHandler } from "../../../../server/http/handlers/ledger";

/**
 * The route that writes to the ledger.
 *
 * Everything it enforces lives behind `guardedPostJournalEntry`: the permission
 * check, the Serializable transaction, the journal-number allocation under
 * `SELECT … FOR UPDATE`, and the database invariants that refuse an unbalanced
 * or backdated-into-a-locked-period entry at COMMIT.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, postEntryHandler()),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

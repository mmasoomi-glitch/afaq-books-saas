import { toRouteHandler } from "../../../../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../../../../server/http/config";
import { withOrgScope } from "../../../../../../../server/http/handlers/scoped";
import { transitionPeriodHandler } from "../../../../../../../server/http/handlers/ledger";

/**
 * The period is named in the URL, never in the body, so a caller cannot pass
 * the checks for one period and transition another.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; periodId: string }> },
): Promise<Response> {
  const { orgSlug, periodId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, transitionPeriodHandler(periodId)),
    adapterConfig(),
  )(request);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { toRouteHandler } from "../../../server/http/adapters/web";
import { adapterConfig } from "../../../server/http/config";
import { withOrgScope } from "../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../server/http/types";
import { json, error } from "../../../server/http/types";
import { prisma } from "../../../server/db/client";

export function syncHistoryHandler() {
  return async (
    req: HttpRequest,
    scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/sync-history$/,
    );
    if (!match) {
      return error(404, "NOT_FOUND", "not found");
    }

    const connectorId = match[1] ?? "";
    if (!connectorId) {
      return error(400, "BAD_REQUEST", "missing connector id");
    }

    // Parse optional query params from the request path
    const url = new URL(path, "http://localhost");
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const status = url.searchParams.get("status") ?? undefined;

    const page = Math.min(
      100,
      Math.max(1, Number.isFinite(limit) ? limit : 20),
    );

    const where: {
      connectorId: string;
      tenantId: string;
      status?: string;
    } = {
      connectorId,
      tenantId: scope.organizationId,
    };

    if (status) {
      where.status = status;
    }

    const [runs, total] = await Promise.all([
      prisma.syncRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: page,
        select: {
          id: true,
          operation: true,
          status: true,
          cursor: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.syncRun.count({ where }),
    ]);

    return json(200, {
      success: true,
      connectorId,
      tenantId: scope.organizationId,
      total,
      page,
      runs: runs.map((run) => ({
        ...run,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      })),
    });
  };
}

export async function syncHistoryRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId: _connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, syncHistoryHandler()),
    adapterConfig(),
  )(request);
}

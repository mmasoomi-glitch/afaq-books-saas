import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../../server/http/types";
import { ConnectorRegistry } from "../registry";
import { AuthManager } from "../auth-manager";
import { json, error } from "../../../../server/http/types";
import { prisma } from "../../../../server/db/client";
import { ConnectorNotFoundError } from "../errors";

let registry: ConnectorRegistry | null = null;
let authManager: AuthManager | null = null;

export function initUninstallDeps(
  registryRef: ConnectorRegistry,
  authManagerRef: AuthManager,
) {
  registry = registryRef;
  authManager = authManagerRef;
}

export function uninstallHandler() {
  return async (
    req: HttpRequest,
    scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    if (!registry || !authManager) {
      return error(503, "SERVICE_UNAVAILABLE", "integration platform not initialized");
    }

    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/uninstall$/,
    );
    if (!match) {
      return error(404, "NOT_FOUND", "not found");
    }

    const connectorId = match[1];
    const connector = registry.getById(connectorId);
    if (connector === undefined) {
      throw new ConnectorNotFoundError(
        `connector ${connectorId} not found`,
        connectorId,
      );
    }

    // 1. Revoke credentials (deletes encrypted store entry)
    authManager.revokeCredentials(connectorId, scope.organizationId);

    // 2. Archive active sync runs by marking them as completed with a note
    await prisma.syncRun.updateMany({
      where: {
        connectorId,
        tenantId: scope.organizationId,
        status: { in: ["pending", "running"] },
      },
      data: {
        status: "failed",
        error: "connector_uninstalled",
      },
    });

    return json(200, {
      success: true,
      connectorId,
      tenantId: scope.organizationId,
      uninstalled: true,
    });
  };
}

export async function uninstallRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId: _connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, uninstallHandler()),
    adapterConfig(),
  )(request);
}

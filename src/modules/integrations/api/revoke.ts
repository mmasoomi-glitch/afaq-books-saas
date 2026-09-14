import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../../server/http/types";
import { ConnectorRegistry } from "../registry";
import { AuthManager } from "../auth-manager";
import { json, error } from "../../../../server/http/types";
import { ConnectorNotFoundError } from "../errors";

let registry: ConnectorRegistry | null = null;
let authManager: AuthManager | null = null;

export function initRevokeDeps(
  registryRef: ConnectorRegistry,
  authManagerRef: AuthManager,
) {
  registry = registryRef;
  authManager = authManagerRef;
}

export function revokeHandler() {
  return async (
    req: HttpRequest,
    scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    if (!registry || !authManager) {
      return error(503, "SERVICE_UNAVAILABLE", "integration platform not initialized");
    }

    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/revoke$/,
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

    authManager.revokeCredentials(connectorId, scope.organizationId);

    // Record revocation in sync run history
    return json(200, {
      success: true,
      connectorId,
      tenantId: scope.organizationId,
      revoked: true,
    });
  };
}

export async function revokeRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId: _connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, revokeHandler()),
    adapterConfig(),
  )(request);
}

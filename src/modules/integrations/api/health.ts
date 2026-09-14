import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../../server/http/types";
import { ConnectorRegistry } from "../registry";
import { ConnectorNotFoundError } from "../errors";
import { json, error } from "../../../../server/http/types";

let registry: ConnectorRegistry | null = null;

export function initHealthDeps(
  registryRef: ConnectorRegistry,
) {
  registry = registryRef;
}

export function healthHandler() {
  return async (
    req: HttpRequest,
    _scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    if (!registry) {
      return error(503, "SERVICE_UNAVAILABLE", "integration platform not initialized");
    }

    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/health$/,
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

    // Return manifest-level health info — NOT credentials
    return json(200, {
      success: true,
      connectorId,
      name: connector.manifest.name,
      version: connector.manifest.version,
      provider: connector.manifest.provider,
      capabilities: connector.manifest.capabilities,
      syncDirections: connector.manifest.sync_directions,
      isActive: true,
      authType: connector.manifest.authentication_type,
    });
  };
}

export async function healthRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId: _connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, healthHandler()),
    adapterConfig(),
  )(request);
}

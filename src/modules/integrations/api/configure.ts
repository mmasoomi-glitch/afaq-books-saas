import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../../server/http/types";
import { ConnectorRegistry } from "../registry";

let registry: ConnectorRegistry | null = null;
let authManager: AuthManager | null = null;

export function initConfigureDeps(
  registryRef: ConnectorRegistry,
  authManagerRef: AuthManager,
) {
  registry = registryRef;
  authManager = authManagerRef;
}

export function configureHandler() {
  return async (
    req: HttpRequest,
    scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    if (!registry || !authManager) {
      return error(503, "SERVICE_UNAVAILABLE", "integration platform not initialized");
    }

    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/configure$/,
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

    const body = req.body as Record<string, unknown> | undefined;
    const config: Record<string, string> = {};

    if (typeof body === "object" && body !== null) {
      for (const key of Object.keys(body)) {
        const val = (body as Record<string, unknown>)[key];
        if (typeof val === "string" && val.length > 0) {
          config[key] = val;
        }
      }
    }

    authManager.storeCredentials(
      connectorId,
      scope.organizationId,
      config,
    );

    // Return only metadata — NEVER the credentials
    return json(200, {
      success: true,
      connectorId,
      tenantId: scope.organizationId,
      configured: true,
      configurationSchema: connector.manifest.configuration_schema,
    });
  };
}

export async function configureRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId: _connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, configureHandler()),
    adapterConfig(),
  )(request);
}

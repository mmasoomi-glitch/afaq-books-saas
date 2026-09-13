import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { withOrgScope } from "../../../../server/http/handlers/scoped";
import type { HttpRequest, HttpResponse } from "../../../../server/http/types";
import { readString } from "../../../../server/http/handlers/scoped";
import { ConnectorRegistry } from "../../registry";
import { AuthManager } from "../../auth-manager";
import { json, error } from "../../../../server/http/types";
import { ConnectorNotFoundError } from "../../errors";

let registry: ConnectorRegistry | null = null;
let authManager: AuthManager | null = null;

export function initInstallDeps(
  registryRef: ConnectorRegistry,
  authManagerRef: AuthManager,
) {
  registry = registryRef;
  authManager = authManagerRef;
}

export function installHandler() {
  return async (
    req: HttpRequest,
    scope: { organizationId: string; userId: string },
  ): Promise<HttpResponse> => {
    if (!registry || !authManager) {
      return error(503, "SERVICE_UNAVAILABLE", "integration platform not initialized");
    }

    const path = req.path;
    const match = path.match(
      /^\/api\/o\/[^/]+\/integrations\/([^/]+)\/install$/,
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
    const redirectUrl = readString(body ?? {}, "redirect_url");
    const state = readString(body ?? {}, "state");

    if (connector.manifest.authentication_type === "oauth2") {
      // Build the OAuth2 authorization URL
      const params = new URLSearchParams({
        response_type: "code",
        client_id:
          (body?.client_id as string) ??
          connector.manifest.configuration_schema?.client_id as string ??
          "",
        redirect_uri:
          (body?.redirect_uri as string) ??
          (connector.manifest.configuration_schema?.redirect_uri as string) ??
          "",
        scope: connector.manifest.required_scopes.join(" "),
        ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
        ...(state ? { state } : {}),
      });

      const authUrl = `https://${connector.manifest.provider}.com/oauth/authorize?${params.toString()}`;

      return json(200, {
        success: true,
        authUrl,
        connectorId,
      });
    }

    // For non-OAuth2 connectors, store the initial config
    const credentials: Record<string, string> = {};
    if (typeof body === "object" && body !== null) {
      for (const key of Object.keys(body)) {
        const val = (body as Record<string, unknown>)[key];
        if (typeof val === "string" && val.length > 0) {
          credentials[key] = val;
        }
      }
    }

    authManager.storeCredentials(
      connectorId,
      scope.organizationId,
      credentials,
    );

    return json(200, {
      success: true,
      connectorId,
      tenantId: scope.organizationId,
      authType: connector.manifest.authentication_type,
    });
  };
}

export async function installRoute(
  request: Request,
  ctx: { params: Promise<{ orgSlug: string; connectorId: string }> },
): Promise<Response> {
  const { orgSlug, connectorId } = await ctx.params;
  return toRouteHandler(
    withOrgScope(orgSlug, installHandler()),
    adapterConfig(),
  )(request);
}

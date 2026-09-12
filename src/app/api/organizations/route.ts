import { toRouteHandler } from "../../../server/http/adapters/web";
import { adapterConfig } from "../../../server/http/config";
import { createOrganizationHandler } from "../../../server/http/handlers/organizations";

/**
 * Not organization-scoped, for the obvious reason: it is what creates one.
 *
 * It resolves the session directly and answers 401 rather than the 404 the
 * scoped routes use. No organization is named here, so there is nothing whose
 * existence a 401 could confirm — the enumeration argument that shapes every
 * other route simply does not apply.
 */
export const POST = toRouteHandler(createOrganizationHandler(), adapterConfig());

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

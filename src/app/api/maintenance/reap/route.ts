import { toRouteHandler } from "../../../../server/http/adapters/web";
import { adapterConfig } from "../../../../server/http/config";
import { reapHandler } from "../../../../server/http/handlers/maintenance";

/**
 * Called by an external scheduler, not by a browser. Authenticated by a shared
 * secret header rather than a session — there is no user here to have one.
 */
export const POST = toRouteHandler(reapHandler(), adapterConfig());

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

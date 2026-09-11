import { toRouteHandler } from "../../../../server/http/adapters/web.js";
import { adapterConfig } from "../../../../server/http/config.js";
import { sessionHandler } from "../../../../server/http/handlers/auth.js";

/**
 * The endpoint that keeps an active session alive.
 *
 * It re-sends the session cookie on every success, which is what the one-hour
 * `Max-Age` depends on: the browser's copy is refreshed while the user is
 * working and simply lapses when they stop. It also slides the server row's
 * expiry forward, capped at the absolute ceiling measured from creation.
 *
 * No Origin check, because it is a GET and changes no state the caller does not
 * already have. It takes no `authHandlerConfig` for the same reason.
 */
export const GET = toRouteHandler(sessionHandler(), adapterConfig());

// Must never be cached or statically rendered. The response contains the
// authenticated user's id and a fresh Set-Cookie; a cached copy would hand the
// next visitor somebody else's session.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { toRouteHandler } from "../../../../server/http/adapters/web.js";
import {
  adapterConfig,
  authHandlerConfig,
} from "../../../../server/http/config.js";
import { signInHandler } from "../../../../server/http/handlers/auth.js";

/**
 * One line of routing, and that is the point.
 *
 * Everything this endpoint does — rate limiting on both dimensions, the
 * constant-time password check, the `__Host-` cookies, the Origin check, the
 * 429 with `Retry-After` — lives behind `signInHandler` and is tested by
 * calling a function. This file adapts and nothing else, so there is no place
 * here for a check to be forgotten.
 */
export const POST = toRouteHandler(
  signInHandler(authHandlerConfig()),
  adapterConfig(),
);

// Sessions and rate-limit counters are rows in Postgres. A cached response here
// would return someone else's sign-in result, so the route is explicitly
// dynamic rather than relying on Next inferring it from the handler's shape.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

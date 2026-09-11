import { toRouteHandler } from "../../../../server/http/adapters/web.js";
import {
  adapterConfig,
  authHandlerConfig,
} from "../../../../server/http/config.js";
import { signOutHandler } from "../../../../server/http/handlers/auth.js";

/**
 * POST, never GET, and that is a security property rather than a convention.
 *
 * `SameSite=Lax` still sends the session cookie on a top-level cross-site GET —
 * that is what makes a link from an email arrive authenticated. So a
 * state-changing GET is reachable from a hostile page by a plain anchor, and
 * exposing sign-out that way would let any site sign our users out by embedding
 * a link. As a POST it needs the CSRF token, which a cross-origin page cannot
 * read.
 */
export const POST = toRouteHandler(
  signOutHandler(authHandlerConfig()),
  adapterConfig(),
);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

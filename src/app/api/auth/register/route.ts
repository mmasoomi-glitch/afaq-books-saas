import { toRouteHandler } from "../../../../server/http/adapters/web.js";
import {
  adapterConfig,
  authHandlerConfig,
} from "../../../../server/http/config.js";
import { registerHandler } from "../../../../server/http/handlers/auth.js";

/**
 * Registration creates an account with NO membership, so the user it creates
 * can authenticate and reach no organization's data at all until someone grants
 * one. It does not sign them in.
 *
 * Two limitations this endpoint carries, both filed rather than hidden:
 *
 *  - It cannot be CSRF-protected by double submit, because there is no cookie
 *    yet to submit twice (`B-20260912-01`). The Origin check is the control
 *    here, and it is incomplete — a caller that omits `Origin` passes.
 *  - It reveals whether an address is already registered, because it has to:
 *    a user whose sign-up silently fails cannot proceed. That is why the
 *    sign-up limiter is tighter than the sign-in one, 3 per hour against 5 per
 *    15 minutes. Email confirmation is what would close it properly, and does
 *    not exist yet.
 */
export const POST = toRouteHandler(
  registerHandler(authHandlerConfig()),
  adapterConfig(),
);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { HttpHandler, HttpRequest, HttpResponse } from "../types";
import { error, isMutating } from "../types";
import { SESSION_COOKIE } from "../cookies";
import type { OrgScope } from "../../auth/scope";
import { resolveScopeFromSession } from "../../auth/session";
import { AuthError } from "../../auth/errors";
import { RateLimitedError, enforce } from "../../auth/rate-limit";

/**
 * Turns a framework-agnostic handler into one that receives a VERIFIED
 * organization scope, or never runs at all.
 *
 * This is the API-route counterpart of `src/server/next/page-scope.ts`. The two
 * answer the same conditions differently, and that asymmetry is deliberate
 * enough to be written down in one place — here.
 */

export type ScopedHandler = (
  req: HttpRequest,
  scope: OrgScope,
) => Promise<HttpResponse>;

/** Every failure answers identically. See `notFound` below for why. */
function notFound(): HttpResponse {
  return error(404, "NOT_FOUND", "not found");
}

/**
 * 404 for everything, including "no session at all".
 *
 * `.claude/rules/security-tenancy.md` requires that another organization's
 * identifier passed to a scoped route returns 404 — "not 200, not 403 with the
 * body leaking the existence". A 403 confirms the organization exists and that
 * you are merely not in it, which turns the URL into an enumeration oracle over
 * the customer list.
 *
 * **"No session" is 404 rather than 401, and the trade-off is real.** A 401
 * would be more informative to a legitimate client — and that same
 * informativeness tells an unauthenticated prober that the slug it guessed is a
 * real organization. The client that actually matters here is our own page
 * JavaScript, and it already knows whether it holds a session; it does not need
 * the server to tell it.
 *
 * **The page equivalent answers differently on purpose.** `requirePageScope`
 * REDIRECTS an unauthenticated visitor to the sign-in form, because a page is
 * something a person navigates to and the form is the useful answer. An API
 * route is called by code that either holds a session or does not, and a
 * redirect would be followed and the sign-in HTML parsed as if it were the
 * response. Same condition, different correct answer.
 *
 * The handler runs only AFTER the scope resolves, so a scoped handler can never
 * be reached with an unverified organization. Membership is re-resolved on
 * every request rather than cached in the session, which is what makes
 * revocation take effect on the next call instead of whenever a token expires.
 */
export function withOrgScope(
  organizationSlug: string,
  handler: ScopedHandler,
): HttpHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const token = req.cookies[SESSION_COOKIE];
    if (token === undefined || token === "") return notFound();

    let scope: OrgScope;
    try {
      scope = await resolveScopeFromSession(token, organizationSlug);
    } catch (err) {
      if (err instanceof AuthError) return notFound();

      // A Prisma failure or a null dereference turning into a 404 would hide a
      // bug behind a response that looks like a legitimate "not found". The
      // outermost adapter is where it becomes a 500.
      throw err;
    }

    // Every authenticated WRITE is rate limited, and it is enforced HERE so a
    // new endpoint cannot forget it. A limit applied in each handler is a
    // limit the twelfth handler will not have.
    //
    // Not an authorization control: everyone reaching this line is already a
    // member holding the permission for what they are doing. It is resource
    // protection against a runaway script or a compromised session.
    //
    // Reads are deliberately not limited. They are cheap, they are the bulk of
    // normal use, and a report that refuses to render because someone
    // refreshed it is a worse failure than the one being prevented.
    if (isMutating(req.method)) {
      try {
        await enforce("write", req.ip, scope.userId);
      } catch (err) {
        if (err instanceof RateLimitedError) {
          return error(429, err.code, err.message, {
            headers: {
              "retry-after": String(Math.ceil(err.retryAfterMs / 1000)),
            },
          });
        }
        throw err;
      }
    }

    // Outside the try, so a genuine error thrown BY THE HANDLER is not
    // mistaken for an authorization failure and answered with 404.
    return handler(req, scope);
  };
}

/**
 * A string field from a request body, narrowed rather than cast.
 *
 * A cast would let `{ email: { $ne: null } }` satisfy `as { email: string }`
 * and reach the query layer as an object.
 *
 * `getOwnPropertyDescriptor` rather than indexing, which also closes a smaller
 * hole: `"constructor" in {}` is `true`, and a plain index would walk the
 * prototype chain and return `Object.prototype.constructor`. Both end up
 * rejected by the `typeof` check below, but reading an own property is the
 * question we meant to ask.
 */
export function readString(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(body, field);
  if (descriptor === undefined) return undefined;

  const value: unknown = descriptor.value;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

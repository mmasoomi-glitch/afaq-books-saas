/**
 * The framework-agnostic HTTP contract.
 *
 * Handlers here take a plain object and return a plain object. They import no
 * web framework, and nothing in `src/server/http/` may. A Next.js route handler
 * will later translate its `Request` into `HttpRequest` and an `HttpResponse`
 * back into a `Response` — that adapter is the only place framework types are
 * allowed to appear.
 *
 * The reason is the same one that shaped the session layer: every security
 * property in this directory — CSRF rejection, cookie attributes, the 429 and
 * its Retry-After — is then assertable by calling a function with an object,
 * with no server booted and no HTTP stack in the way. A control that is hard to
 * test is a control that eventually stops being tested.
 *
 * Decided in advance by independent review rather than on the day; see
 * B-20260911-10 in docs/coordination/BLOCKERS.md.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  /** Header names are LOWERCASED by the adapter before they get here. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly cookies: Readonly<Record<string, string | undefined>>;
  /** Already-parsed JSON body, or undefined. Handlers must validate it. */
  readonly body?: unknown;
  /** Source address, when the adapter can determine one. */
  readonly ip?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Raw Set-Cookie values, already serialised. */
  readonly cookies?: readonly string[];
  readonly body?: unknown;
}

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

export interface ErrorBody {
  error: { code: string; message: string };
}

export function json(
  status: number,
  body: unknown,
  extra?: { headers?: Record<string, string>; cookies?: string[] },
): HttpResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extra?.headers,
    },
    ...(extra?.cookies === undefined ? {} : { cookies: extra.cookies }),
    body,
  };
}

/**
 * A machine-readable `code` alongside the human `message`, because the client
 * needs to distinguish "wrong password" from "rate limited" without parsing
 * prose. The message is for a person; the code is for the caller.
 */
export function error(
  status: number,
  code: string,
  message: string,
  extra?: { headers?: Record<string, string> },
): HttpResponse {
  const body: ErrorBody = { error: { code, message } };
  return json(status, body, extra === undefined ? undefined : { ...extra });
}

export function noContent(extra?: { cookies?: string[] }): HttpResponse {
  return {
    status: 204,
    ...(extra?.cookies === undefined ? {} : { cookies: extra.cookies }),
  };
}

/**
 * Whether a method changes state, which is what decides whether a request needs
 * a CSRF token.
 *
 * The consequence runs the other way too: a state-changing endpoint must never
 * be exposed as GET. `SameSite=Lax` still sends the session cookie on top-level
 * cross-site GET navigation — that is the whole point of Lax, and why an email
 * link to the app keeps working. So a state-changing GET is reachable from a
 * hostile page by a plain `<a>` or a redirect, in a way a POST is not. Routing
 * a mutation through GET silently opts it out of every protection below.
 */
export function isMutating(method: HttpMethod): boolean {
  return (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

/**
 * Required by .claude/rules/security-tenancy.md.
 *
 * The CSP is deliberately near-total: these endpoints return JSON and never
 * HTML, so there is no legitimate script, style or frame to allow. A UI will
 * need a looser policy and must write its own — copying this one will break it,
 * and loosening THIS one to make a page work would quietly remove the header's
 * value from every API response at once.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",

  // `no-store`, and it is not belt-and-braces.
  //
  // Found by independent review and then confirmed against the running server:
  // these responses carried NO cache directive at all. `force-dynamic` controls
  // Next's own cache and says nothing to a CDN or a browser, and a 200 from
  // `GET /api/auth/session` — a JSON body naming the authenticated user, with a
  // fresh `Set-Cookie` on it — is heuristically cacheable by any shared proxy
  // that decides to. One cached copy served to the next visitor is an account
  // takeover with no attacker involved.
  //
  // `private` would not be enough: it permits the BROWSER to keep a copy, which
  // is still wrong on a shared machine after sign-out. `no-store` is the only
  // directive that means what is meant here.
  "cache-control": "no-store",
});

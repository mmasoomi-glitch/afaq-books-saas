import type { HttpRequest, HttpResponse } from "../types";
import { SECURITY_HEADERS, error, json, noContent } from "../types";
import {
  CSRF_COOKIE,
  CSRF_COOKIE_OPTIONS,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  expireCookie,
  serializeCookie,
} from "../cookies";
import {
  CsrfError,
  assertSameOrigin,
  issueCsrfToken,
  verifyCsrf,
} from "../csrf";
import { AuthError } from "../../auth/errors";
import {
  AlreadyAMemberError,
  NotAMemberOfThisOrgError,
  SlugTakenError,
  UserNotFoundError,
} from "../../auth/membership";
import { RateLimitedError } from "../../auth/rate-limit";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  SessionExpiredError,
  SessionNotFoundError,
  registerUser,
  resolveSession,
  signIn,
  signOut,
  touchSession,
} from "../../auth/session";

/**
 * The authentication endpoints, as plain functions.
 *
 * Every one of them takes an `HttpRequest` object and returns an
 * `HttpResponse` object. Nothing here knows what a framework is, so the tests
 * for the things that matter — that a 429 carries a Retry-After, that sign-out
 * clears the cookie with matching attributes, that an expired session is
 * indistinguishable from one that never existed — are calls to a function.
 */

export interface AuthHandlerConfig {
  readonly expectedOrigin?: string;
}

/**
 * Security headers go UNDER the response's own, so a handler that needs to set
 * one wins rather than being silently overridden. In practice nothing overlaps;
 * the ordering is written down so that if something ever does, the behaviour is
 * a decision rather than an accident of iteration order.
 */
function withSecurity(res: HttpResponse): HttpResponse {
  return {
    ...res,
    headers: { ...SECURITY_HEADERS, ...res.headers },
  };
}

interface Credentials {
  email: string;
  password: string;
}

/**
 * The body arrives from the network as `unknown` and is NARROWED here, not
 * cast. A cast is a promise the compiler cannot check: `{ email: { $ne: null } }`
 * would satisfy `as { email: string }` and reach the database layer as an
 * object, which is how a query-shaped payload becomes a query.
 *
 * The email is trimmed and lowercased at this single point because it is both
 * the uniqueness key for an account and the key the rate limiter counts on.
 * Normalising it anywhere less central means `Bob@x.com` and `bob@x.com` are
 * two accounts with two independent budgets of guesses.
 *
 * The password is NOT trimmed. Leading and trailing spaces are legitimate
 * characters in a passphrase, and silently stripping them makes a password
 * that was accepted at registration fail at sign-in.
 */
function readCredentials(body: unknown): Credentials | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  if (!("email" in body) || !("password" in body)) return undefined;

  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string") {
    return undefined;
  }

  const normalised = email.trim().toLowerCase();
  if (normalised === "" || password === "") return undefined;

  return { email: normalised, password };
}

/** Optional display name, read with the same narrowing discipline. */
function readName(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("name" in body)) {
    return undefined;
  }
  const { name } = body;
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function sessionCookies(rawToken: string, csrfToken: string): string[] {
  return [
    serializeCookie(SESSION_COOKIE, rawToken, SESSION_COOKIE_OPTIONS),
    serializeCookie(CSRF_COOKIE, csrfToken, CSRF_COOKIE_OPTIONS),
  ];
}

/**
 * `httpOnly` must match the flag used when the cookie was SET. A browser that
 * sees a deletion whose attributes differ leaves the original in place and
 * stores a second, empty cookie — a sign-out that returns 204 and does nothing,
 * which is exactly the class of bug this repository's rules exist to prevent.
 */
export function clearedCookies(): string[] {
  return [expireCookie(SESSION_COOKIE, true), expireCookie(CSRF_COOKIE, false)];
}

/**
 * The single place an error becomes a status code.
 *
 * Anything not recognised is RETHROWN rather than flattened into a 500 here.
 * A catch-all at this depth would convert a genuine bug — a Prisma failure, a
 * null dereference — into a tidy JSON error that looks handled, and it would
 * look handled in the tests too. The outermost adapter logs it and returns the
 * 500; that is the right altitude for it.
 */
export function toErrorResponse(err: unknown): HttpResponse {
  if (err instanceof RateLimitedError) {
    // Retry-After is expressed in SECONDS, and the conversion rounds UP. Rounding
    // down would hand the client a moment at which it is still blocked, so a
    // well-behaved client would be refused for obeying us.
    const seconds = Math.ceil(err.retryAfterMs / 1000);
    return error(429, err.code, err.message, {
      headers: { "retry-after": String(seconds) },
    });
  }

  if (err instanceof CsrfError) {
    // The specific reason lives on the error for the log. It does NOT go in the
    // body: telling a probe whether the cookie or the header was missing tells
    // it which half of the double-submit to work on next.
    return error(403, "CSRF_INVALID", "request rejected");
  }

  if (err instanceof InvalidCredentialsError) {
    return error(401, err.code, err.message);
  }

  if (
    err instanceof SessionExpiredError ||
    err instanceof SessionNotFoundError
  ) {
    // Merged deliberately. "Expired" and "no such session" are different facts,
    // and the difference is worth something to an attacker holding a guessed or
    // stolen token: "expired" confirms the token was once real, which means the
    // guess was structurally right. The status and body are identical; only the
    // code differs, and it is stable rather than informative.
    return error(401, err.code, "not authenticated");
  }

  if (err instanceof EmailAlreadyRegisteredError) {
    return error(409, err.code, err.message);
  }

  // Conflicts, not refusals. The caller is permitted to do this; the state
  // simply already exists, and 403 would tell them to go and get permission
  // they already have.
  if (err instanceof AlreadyAMemberError || err instanceof SlugTakenError) {
    return error(409, err.code, err.message);
  }

  // The TARGET could not be found. 404 rather than 403 for the same reason
  // scoped routes use it: "that user is not a member of this organization" and
  // "there is no such user" are different facts, and confirming which one
  // applies turns an administration screen into a directory lookup.
  if (
    err instanceof UserNotFoundError ||
    err instanceof NotAMemberOfThisOrgError
  ) {
    return error(404, err.code, err.message);
  }

  // Everything else that is an AuthError is a refusal: ForbiddenError,
  // RoleEscalationError, OwnershipTransferError, CannotTransferToSelfError.
  // 403 is correct for all of them — the caller is authenticated, is a member,
  // and is not allowed to do this particular thing. The message names the rule
  // rather than the data, so it reveals nothing about the organization.
  if (err instanceof AuthError) {
    return error(403, err.code, err.message);
  }

  throw err;
}

function methodNotAllowed(expected: string): HttpResponse {
  return withSecurity(
    error(405, "METHOD_NOT_ALLOWED", `${expected} required`, {
      headers: { allow: expected },
    }),
  );
}

export function signInHandler(
  config?: AuthHandlerConfig,
): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "POST") return methodNotAllowed("POST");

    try {
      const expectedOrigin = config?.expectedOrigin;
      if (expectedOrigin !== undefined) assertSameOrigin(req, expectedOrigin);

      // Sign-in IS csrf-protected now, which it could not be before.
      //
      // The old circularity was real: the token cookie was issued BY the
      // sign-in response, so there was nothing to submit twice. `src/middleware.ts`
      // breaks it by committing the cookie one request earlier, on the page that
      // carries the form, and handing the same value to the renderer to embed.
      //
      // What this closes is login CSRF — a hostile page making a victim's
      // browser sign in as the ATTACKER, so the invoices and journal entries the
      // victim then creates land in the attacker's organization and are readable
      // by them. In an accounting product that is a real loss of confidential
      // data, not a curiosity.
      //
      // Worth recording honestly: `SameSite=Lax` already blocks cookies on a
      // cross-site POST, so the forged request arrives with no cookie and is
      // refused on that ground alone. This check is therefore defence in depth
      // rather than the only thing standing there — it covers clients that do
      // not implement SameSite, and it fails closed if the cookie's attributes
      // are ever loosened. See B-20260912-01.
      //
      // The cost, stated: a non-browser client must now fetch the sign-in page
      // for a token before it can authenticate. That is the correct trade for a
      // browser-facing product; a machine-to-machine path would want API keys,
      // not this.
      verifyCsrf(req);

      const credentials = readCredentials(req.body);
      if (credentials === undefined) {
        return withSecurity(
          error(400, "INVALID_BODY", "email and password are required"),
        );
      }

      const result = await signIn(
        credentials.email,
        credentials.password,
        req.ip === undefined ? {} : { ip: req.ip },
      );

      return withSecurity(
        json(
          200,
          {
            userId: result.userId,
            expiresAt: result.expires.toISOString(),
          },
          { cookies: sessionCookies(result.rawToken, issueCsrfToken()) },
        ),
      );
    } catch (err) {
      return withSecurity(toErrorResponse(err));
    }
  };
}

export function signOutHandler(
  config?: AuthHandlerConfig,
): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "POST") return methodNotAllowed("POST");

    try {
      const expectedOrigin = config?.expectedOrigin;
      if (expectedOrigin !== undefined) assertSameOrigin(req, expectedOrigin);

      // Sign-out IS csrf-protected. Forcing a victim to sign out is only a
      // nuisance, but it is a nuisance an attacker can inflict repeatedly, and
      // the token is already in hand by this point so there is no reason not to.
      verifyCsrf(req);

      const token = req.cookies[SESSION_COOKIE];

      // Idempotent. Signing out when not signed in returns the same 204 with the
      // same cleared cookies: there is nothing useful to say, and saying "you
      // were not signed in" is a small oracle about whose cookie is live.
      if (token !== undefined && token !== "") {
        await signOut(token);
      }

      return withSecurity(noContent({ cookies: clearedCookies() }));
    } catch (err) {
      return withSecurity(toErrorResponse(err));
    }
  };
}

export function sessionHandler(): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "GET") return methodNotAllowed("GET");

    try {
      const token = req.cookies[SESSION_COOKIE];
      if (token === undefined || token === "") {
        return withSecurity(
          error(401, "AUTH_SESSION_NOT_FOUND", "not authenticated"),
        );
      }

      // Resolve first — it is the authoritative check and it yields the user.
      // Then slide, which re-validates and is a no-op unless the expiry has
      // drifted far enough to be worth a write.
      const session = await resolveSession(token);
      const expires = await touchSession(token);

      // The session cookie is RE-SENT on every successful request, and the
      // one-hour Max-Age depends on exactly that: the browser's copy is
      // refreshed while the user is working and simply lapses when they stop.
      // A one-hour cookie without this line would sign everyone out hourly.
      //
      // The CSRF cookie is deliberately NOT re-issued here. It has no
      // server-side state, so rotating it buys nothing, while a fresh value
      // would not match the one a request already in flight is carrying — the
      // user would see a spurious 403 for having two tabs open.
      return withSecurity(
        json(
          200,
          { userId: session.userId, expiresAt: expires.toISOString() },
          {
            cookies: [
              serializeCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS),
            ],
          },
        ),
      );
    } catch (err) {
      return withSecurity(toErrorResponse(err));
    }
  };
}

export function registerHandler(
  config?: AuthHandlerConfig,
): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "POST") return methodNotAllowed("POST");

    try {
      const expectedOrigin = config?.expectedOrigin;
      if (expectedOrigin !== undefined) assertSameOrigin(req, expectedOrigin);

      // Protected for the same reason and by the same mechanism as sign-in:
      // the middleware issues the token on the registration page. A forged
      // registration is a lesser harm than a forged sign-in — it creates an
      // account rather than capturing the victim's work — but it is still an
      // account created in someone's name, and the cost of covering it is one
      // line.
      verifyCsrf(req);

      const credentials = readCredentials(req.body);
      if (credentials === undefined) {
        return withSecurity(
          error(400, "INVALID_BODY", "email and password are required"),
        );
      }

      const { userId } = await registerUser(
        credentials.email,
        credentials.password,
        readName(req.body),
        req.ip === undefined ? {} : { ip: req.ip },
      );

      // Registration does NOT sign the user in. The account it creates has no
      // membership, so it can reach no organization's data whatsoever — there
      // is nothing to hand it a session for. Issuing one would also mean a
      // public form that mints working credentials with no proof the address
      // belongs to whoever typed it.
      return withSecurity(json(201, { userId }));
    } catch (err) {
      return withSecurity(toErrorResponse(err));
    }
  };
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { CSRF_COOKIE } from "./cookies";
import type { HttpRequest } from "./types";
import { isMutating } from "./types";

/**
 * Double-submit CSRF.
 *
 * Why this works at all, since it is not obvious: a page on another origin can
 * make the browser SEND our cookies — that is what CSRF is — but the same-origin
 * policy stops it READING them. So it cannot copy the token out of the cookie
 * and into a header. If the header and the cookie match, the request was
 * composed by something that could read our origin's cookies, which a hostile
 * page cannot be.
 *
 * The token is therefore not a secret we check against a database. It is a
 * proof of read access to our own origin. Nothing here needs storage.
 *
 * Required by independent review, which was asked directly whether
 * `SameSite=Lax` alone is sufficient for state-changing financial operations and
 * said it is not. See B-20260911-10.
 */

/**
 * A CUSTOM header, not a form field, and that choice does work.
 *
 * An HTML form can be submitted cross-origin with no preflight — that is the
 * classic CSRF vector — but it can only set a handful of content types and no
 * custom headers at all. Setting `x-csrf-token` from another origin requires
 * `fetch`/`XHR`, which makes the request non-simple and triggers a CORS
 * preflight that our server does not answer. So a plain form POST from a
 * hostile page cannot carry this header even before the value is compared.
 */
export const CSRF_HEADER = "x-csrf-token";

export class CsrfError extends Error {
  readonly code = "CSRF_INVALID";
  readonly reason: string;

  constructor(reason: string) {
    super(`csrf check failed: ${reason}`);
    this.name = "CsrfError";
    this.reason = reason;
  }
}

/** 32 bytes of CSPRNG output. Not stored anywhere; see the header comment. */
export function issueCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyCsrf(req: HttpRequest): void {
  // A GET is not protected, because a GET must not change state — and if one
  // does, the token is not the thing that was wrong. Demanding a token on GET
  // would also break every plain link into the app, which is precisely the
  // traffic `SameSite=Lax` exists to keep working.
  if (!isMutating(req.method)) return;

  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  // Missing is refused rather than skipped. A check that passes when its input
  // is absent is not a check — an attacker would simply omit the cookie.
  if (cookieToken === undefined || cookieToken === "") {
    throw new CsrfError("no csrf cookie");
  }
  if (headerToken === undefined || headerToken === "") {
    throw new CsrfError("no csrf header");
  }

  if (!timingSafeStringEqual(cookieToken, headerToken)) {
    throw new CsrfError("token mismatch");
  }
}

/**
 * Constant-time comparison. `===` returns as soon as two bytes differ, and the
 * difference in timing is measurable often enough to recover a secret one byte
 * at a time.
 *
 * The early return on a length mismatch does leak the LENGTH — stated plainly
 * rather than glossed over. It is acceptable here because every token this
 * module issues is the same fixed length, so the length is public by
 * construction and carries nothing. `timingSafeEqual` throws on unequal
 * lengths, so the check has to happen somewhere regardless.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A second layer behind the token, not a replacement for it.
 *
 * A present `Origin` that does not match is strong evidence of an attack, so it
 * is refused. An ABSENT `Origin` is not: browsers send it on mutating
 * cross-origin requests, but same-origin requests and non-browser callers may
 * omit it, so treating absence as hostile would break legitimate traffic while
 * an attacker cannot use the absence for anything the token does not already
 * cover.
 *
 * The comparison is exact — never `endsWith`, never `includes`. A suffix check
 * for "example.com" accepts `https://example.com.evil.net`, and a substring
 * check accepts `https://evil.net/?x=example.com`. Both are standard bypasses,
 * and both look correct in review, which is why the rule is written down here
 * rather than left to judgement.
 */
export function assertSameOrigin(req: HttpRequest, expectedOrigin: string): void {
  const origin = req.headers["origin"];
  if (origin === undefined) return;
  if (origin !== expectedOrigin) {
    throw new CsrfError(`origin mismatch: ${origin}`);
  }
}

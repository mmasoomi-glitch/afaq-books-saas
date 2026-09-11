import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * One job: make sure a request for the sign-in or registration PAGE reaches the
 * renderer with a CSRF token that is ALREADY committed to a cookie, so the page
 * can embed the same value in its HTML.
 *
 * This is what closes login CSRF (`B-20260912-01`). Sign-in could not be
 * double-submit protected before, because the token cookie was issued by the
 * sign-in response itself — there was nothing to submit twice. Issuing it one
 * request earlier, on the page that carries the form, removes that circularity.
 *
 * The constants below are duplicated from `src/server/http/cookies.ts` rather
 * than imported, and that is deliberate: middleware runs on the Edge runtime,
 * and importing that module would drag in the Prisma and argon2 dependency
 * graph, which cannot run there. The duplication is small, and
 * `M1` in tests/unit/http/middleware.test.ts asserts the two agree.
 */

const CSRF_COOKIE = "__Host-csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_MAX_AGE_SECONDS = 3600;

/**
 * `btoa` rather than `Buffer`: the Edge runtime has the former and not the
 * latter. base64url so the value needs no escaping in a cookie — see the
 * character rejection in `serializeCookie`, which would refuse a `+` or a `/`
 * outright rather than encoding around it.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function middleware(request: NextRequest): NextResponse {
  const existing = request.cookies.get(CSRF_COOKIE)?.value;
  const reused = existing !== undefined && existing !== "";

  // Reuse rather than rotate. Minting a fresh token on every page load would
  // invalidate the one a request already in flight is carrying, so a user with
  // two tabs open would get a spurious 403 on whichever submitted second — and
  // it would look like a random failure rather than a rotation policy.
  const token = reused ? existing : toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  // How the value reaches a SERVER COMPONENT.
  //
  // A server component cannot call `cookies().set()` during render — Next
  // throws — so the cookie is committed here, on the response, and the same
  // value is handed to the renderer through a REQUEST header it can read. Any
  // other arrangement has the page guessing at a value it did not set.
  const headers = new Headers(request.headers);
  headers.set(CSRF_HEADER, token);
  const response = NextResponse.next({ request: { headers } });

  if (!reused) {
    // `httpOnly: false` is on purpose. Double-submit needs page JavaScript to
    // read this value and echo it in a header, which HttpOnly would prevent.
    //
    // The consequence, stated rather than skipped: an XSS on our origin can
    // read the CSRF token. That is acceptable because an attacker with XSS can
    // already issue same-origin requests with the session cookie attached —
    // the token was never what stood between them and the ledger. CSRF defends
    // against a DIFFERENT origin, and a different origin cannot read this
    // cookie whatever flags it carries.
    //
    // `secure`, `path: "/"` and the absence of a domain are REQUIRED by the
    // `__Host-` prefix: a browser refuses such a cookie without exactly those.
    // The prefix is what stops a compromised sibling subdomain setting a cookie
    // that shadows this one, which the server would have no way to tell apart.
    response.cookies.set({
      name: CSRF_COOKIE,
      value: token,
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: CSRF_MAX_AGE_SECONDS,
    });
  }

  return response;
}

/**
 * Deliberately narrow.
 *
 * A broad matcher would put an Edge hop in front of every API route, and those
 * routes VERIFY the token — they must not also be in the business of issuing
 * one, or the check becomes a check against a value the same request supplied.
 * Only the two pages that render a form need this.
 */
export const config = { matcher: ["/signin"] };

/**
 * Only `/signin`, even though `/api/auth/register` also verifies the token.
 *
 * The cookie has `Path=/`, so one token covers every endpoint — a visitor who
 * has loaded the sign-in page can register with the same value. Adding
 * `/register` to the matcher before a registration page exists would mean
 * setting a cookie on a 404.
 */

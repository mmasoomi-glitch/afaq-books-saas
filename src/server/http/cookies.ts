/**
 * Cookie serialisation and parsing. Framework-agnostic — nothing is imported
 * here at all, which is the point: these are the exact strings that end up in
 * `Set-Cookie`, and they are assertable by string comparison in a unit test.
 *
 * Both cookie names carry the `__Host-` prefix. That prefix is not decoration:
 * a browser REFUSES a `__Host-` cookie unless it is `Secure`, has `Path=/`, and
 * carries no `Domain` attribute. The attack it closes is shadowing — a
 * compromised sibling subdomain (a marketing site, a status page) setting
 * `session=...` with `Domain=.example.com`, which would then be sent to the app
 * alongside the real one, with the server having no way to tell which is which.
 * With the prefix, that cookie is simply not accepted by the browser.
 *
 * The cost, accepted deliberately: the cookie cannot be shared across
 * subdomains. If the product ever needs a single sign-in spanning
 * `app.` and `reports.`, this decision has to be revisited rather than worked
 * around by dropping the prefix. Chosen by independent review; see
 * B-20260911-10.
 */

export const SESSION_COOKIE = "__Host-session";
export const CSRF_COOKIE = "__Host-csrf";

export interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

/**
 * Reject rather than encode.
 *
 * `;` is the attribute separator in a `Set-Cookie` header and `,` separates
 * cookies in some parsers, so a value containing either can append attributes
 * we did not write — the response-splitting family of bug, whose payoff here is
 * an attacker-chosen `Path` or a dropped `HttpOnly`. Control characters get
 * there via CR/LF and can inject whole headers.
 *
 * The obvious fix is to percent-encode. We do not, because every value this
 * module sets is our own base64url token: a value that needs encoding means
 * something unexpected reached this function, and silently encoding it would
 * hide that. Failing loudly is the more useful behaviour.
 */
function assertCookieSafe(what: string, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new RangeError(`cookie ${what} contains a control character`);
    }
    if (code === 0x20 || code === 0x09) {
      throw new RangeError(`cookie ${what} contains whitespace`);
    }
    if (code === 0x3b || code === 0x2c) {
      throw new RangeError(`cookie ${what} contains ';' or ','`);
    }
  }
}

function assertNameSafe(name: string): void {
  if (name.includes("=")) {
    throw new RangeError("cookie name contains '='");
  }
  assertCookieSafe("name", name);
}

/**
 * `Path=/`, `Secure` and the absence of `Domain` are applied UNCONDITIONALLY,
 * not only when the name starts with `__Host-`. A `__Host-` cookie would be
 * rejected by the browser without them, so the prefix enforces itself — but a
 * future non-prefixed cookie would not, and could be issued insecurely by
 * omission. There is no parameter here to get wrong.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  assertNameSafe(name);
  assertCookieSafe("value", value);

  if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) {
    throw new RangeError("maxAgeSeconds must be a non-negative integer");
  }

  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${String(options.maxAgeSeconds)}`,
    "Secure",
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

/**
 * A browser matches a deletion against name + domain + path. Attributes that
 * differ from the ones used when setting it mean the original cookie is left
 * in place and a second, empty one is created — a sign-out that appears to work
 * and does not. Routing through `serializeCookie` is what keeps the two in
 * step, rather than a hand-written string that drifts.
 */
export function expireCookie(name: string, httpOnly: boolean): string {
  return serializeCookie(name, "", {
    maxAgeSeconds: 0,
    httpOnly,
    sameSite: "Lax",
  });
}

/**
 * The `Cookie` request header is entirely attacker-controlled, so this never
 * throws. A parse error that produced a 500 would be a denial-of-service with a
 * one-line payload.
 *
 * On duplicate names the FIRST occurrence wins, and the choice is arbitrary but
 * must be made explicitly — a browser orders duplicates by path specificity,
 * not by recency, so there is no "correct" one to prefer and picking the last
 * silently would be no better. The real defence against a shadowing duplicate
 * is the `__Host-` prefix above, which stops the second cookie from existing.
 * This is just determinism.
 */
export function parseCookieHeader(
  header: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined || header === "") return cookies;

  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;

    // The FIRST "=" only. A base64url token contains none, but a future value
    // might, and splitting on every "=" would silently truncate it.
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue; // no "=", or an empty name: malformed, skip it

    const name = trimmed.slice(0, eq);
    if (name in cookies) continue;
    cookies[name] = trimmed.slice(eq + 1);
  }

  return cookies;
}

/**
 * One hour, deliberately far shorter than the fourteen-day server session. The
 * session layer slides it forward on use, so an active user is never signed out
 * mid-work, while a cookie that stops being presented becomes useless within
 * the hour instead of within a fortnight.
 *
 * `SameSite=Lax` rather than `Strict` so a link from an email arrives
 * authenticated. Strict would drop the cookie on that navigation and land the
 * user on a sign-in page having just clicked "view invoice", which is the kind
 * of friction that gets security settings turned off. Lax still sends the
 * cookie on top-level cross-site GET, which is exactly why mutations must never
 * be GET and why CSRF tokens exist below.
 */
export const SESSION_COOKIE_OPTIONS: CookieOptions = Object.freeze({
  maxAgeSeconds: 3600,
  httpOnly: true,
  sameSite: "Lax",
});

/**
 * NOT `HttpOnly`, on purpose.
 *
 * The double-submit pattern requires page JavaScript to read this value and
 * echo it in a request header, which `HttpOnly` would prevent. So state the
 * consequence plainly: an XSS on our origin can read the CSRF token.
 *
 * That is acceptable, and the reasoning matters. An attacker with XSS on our
 * origin can already issue same-origin requests with the session cookie
 * attached and read the responses — the CSRF token was never what stood between
 * them and the ledger. CSRF defends against a DIFFERENT origin, and a different
 * origin cannot read this cookie no matter what flags it carries. Making it
 * `HttpOnly` would break the defence that works without improving the one that
 * was already lost.
 */
export const CSRF_COOKIE_OPTIONS: CookieOptions = Object.freeze({
  maxAgeSeconds: 3600,
  httpOnly: false,
  sameSite: "Lax",
});

import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser } from "../../../src/server/auth/session";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../../src/server/http/types";
import {
  registerHandler,
  sessionHandler,
  signInHandler,
  signOutHandler,
} from "../../../src/server/http/handlers/auth";

const PASSWORD = "correct horse battery staple";
const ORIGIN = "https://books.example.com";

beforeEach(async () => {
  // Truncates rate_limits too, so counters do not leak between tests and each
  // one starts with a full budget of attempts.
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

/**
 * A token value shared by the cookie and the header. Its content is irrelevant
 * -- double-submit compares the two halves against each other, never against
 * anything stored -- so a fixed string is as meaningful here as a random one
 * and is far easier to read in a failure.
 */
const CSRF = "csrf-token-for-tests-0123456789";

/**
 * A request already carrying a matched CSRF pair, which is what a browser
 * coming from the sign-in page has. Overrides merge INTO the pair rather than
 * replacing the whole object, so a test can add a cookie without silently
 * dropping the token and then wonder why it got a 403.
 */
function req(method: HttpMethod, over?: Partial<HttpRequest>): HttpRequest {
  return {
    method,
    path: "/",
    ...over,
    headers: { [CSRF_HEADER]: CSRF, ...over?.headers },
    cookies: { [CSRF_COOKIE]: CSRF, ...over?.cookies },
  };
}

/** A request with NO CSRF pair, for the tests that are about its absence. */
function bareReq(method: HttpMethod, over?: Partial<HttpRequest>): HttpRequest {
  return { method, path: "/", headers: {}, cookies: {}, ...over };
}

/** The whole Set-Cookie line for `name`, attributes included. */
function setCookie(res: HttpResponse, name: string): string | undefined {
  return (res.cookies ?? []).find((c) => c.startsWith(`${name}=`));
}

/** Just the value — what the browser would send back on the next request. */
function cookieValue(res: HttpResponse, name: string): string {
  const line = setCookie(res, name);
  if (line === undefined) throw new Error(`no Set-Cookie for ${name}`);
  const semi = line.indexOf(";");
  const pair = semi === -1 ? line : line.slice(0, semi);
  return pair.slice(pair.indexOf("=") + 1);
}

/** Response bodies are `unknown` by design; narrow rather than cast. */
function bodyOf(res: HttpResponse): Record<string, unknown> {
  const body = res.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`expected an object body, got ${String(body)}`);
  }
  return { ...body } as Record<string, unknown>;
}

function errorCode(res: HttpResponse): string {
  const wrapper = bodyOf(res)["error"];
  if (typeof wrapper !== "object" || wrapper === null) {
    throw new Error("response body has no `error` object");
  }
  const code = (wrapper as Record<string, unknown>)["code"];
  if (typeof code !== "string") throw new Error("error.code is not a string");
  return code;
}

function userIdOf(res: HttpResponse): string {
  const id = bodyOf(res)["userId"];
  if (typeof id !== "string") throw new Error("body.userId is not a string");
  return id;
}

interface SignedIn {
  email: string;
  userId: string;
  session: string;
  csrf: string;
}

async function signedIn(): Promise<SignedIn> {
  const email = newEmail();
  await registerUser(email, PASSWORD, "Test User");
  const res = await signInHandler()(
    req("POST", { body: { email, password: PASSWORD } }),
  );
  expect(res.status).toBe(200);
  return {
    email,
    userId: userIdOf(res),
    session: cookieValue(res, SESSION_COOKIE),
    csrf: cookieValue(res, CSRF_COOKIE),
  };
}

test("H1: signing in returns the user id and both cookies", async () => {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);

  const res = await signInHandler()(
    req("POST", { body: { email, password: PASSWORD } }),
  );

  expect(res.status).toBe(200);
  expect(userIdOf(res)).toBe(userId);
  expect(typeof bodyOf(res)["expiresAt"]).toBe("string");
  expect(setCookie(res, SESSION_COOKIE)).toBeDefined();
  expect(setCookie(res, CSRF_COOKIE)).toBeDefined();
});

test("H2: the session cookie is HttpOnly and the csrf cookie is not", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const res = await signInHandler()(
    req("POST", { body: { email, password: PASSWORD } }),
  );

  expect(setCookie(res, SESSION_COOKIE)).toContain("HttpOnly");
  // The csrf cookie must stay readable by page JavaScript, or double-submit has
  // nothing to submit twice. Adding HttpOnly here would look like hardening and
  // would break every mutation.
  expect(setCookie(res, CSRF_COOKIE)).not.toContain("HttpOnly");
});

test("H3: a wrong password is 401 and sets no cookies at all", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler()(
    req("POST", { body: { email, password: "wrong password entirely" } }),
  );

  expect(res.status).toBe(401);
  // A failed sign-in that still handed out a session cookie would be the entire
  // bug, and nothing else in the suite would notice.
  expect(res.cookies ?? []).toHaveLength(0);
});

test("H4: an unknown email and a wrong password are indistinguishable", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const wrongPassword = await signInHandler()(
    req("POST", { body: { email, password: "wrong password entirely" } }),
  );
  const unknownEmail = await signInHandler()(
    req("POST", { body: { email: newEmail(), password: PASSWORD } }),
  );

  // Any difference — status, code, message, even ordering — turns the sign-in
  // form into an oracle for which addresses are registered.
  expect(unknownEmail.status).toBe(wrongPassword.status);
  expect(unknownEmail.body).toEqual(wrongPassword.body);
});

test("H5: a malformed body is 400 before any credential check", async () => {
  const handler = signInHandler();
  const bodies: unknown[] = [
    undefined,
    null,
    "a string",
    [],
    42,
    { email: 1, password: "x" },
    { email: "a@b.c" },
    { password: PASSWORD },
    { email: "   ", password: PASSWORD },
  ];

  for (const body of bodies) {
    const res = await handler(req("POST", { body }));
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("INVALID_BODY");
  }
});

test("H6: an object-shaped email is rejected rather than cast", async () => {
  // This is the payload a cast instead of a narrow would pass straight through
  // to the query layer.
  const res = await signInHandler()(
    req("POST", {
      body: { email: { toString: "x" }, password: PASSWORD },
    }),
  );

  expect(res.status).toBe(400);
  expect(errorCode(res)).toBe("INVALID_BODY");
});

test("H7: the sixth attempt is 429 with a retry-after in whole seconds", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const handler = signInHandler();

  for (let i = 0; i < 5; i += 1) {
    const res = await handler(
      req("POST", { body: { email, password: "wrong password entirely" } }),
    );
    expect(res.status).toBe(401);
  }

  const blocked = await handler(
    req("POST", { body: { email, password: "wrong password entirely" } }),
  );

  expect(blocked.status).toBe(429);
  expect(errorCode(blocked)).toBe("AUTH_RATE_LIMITED");
  // 1000ms of penalty, expressed in seconds and rounded up.
  expect(blocked.headers?.["retry-after"]).toBe("1");
});

test("H8: a GET to sign-in is 405 and says which method it wanted", async () => {
  const res = await signInHandler()(req("GET"));
  expect(res.status).toBe(405);
  expect(res.headers?.["allow"]).toBe("POST");
});

test("H9: the security headers ride on every response, success or failure", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const handler = signInHandler();

  const ok = await handler(
    req("POST", { body: { email, password: PASSWORD } }),
  );
  const denied = await handler(
    req("POST", { body: { email, password: "wrong password entirely" } }),
  );
  const badMethod = await handler(req("GET"));

  for (const res of [ok, denied, badMethod]) {
    expect(res.headers?.["x-frame-options"]).toBe("DENY");
    expect(res.headers?.["x-content-type-options"]).toBe("nosniff");
    expect(res.headers?.["content-security-policy"]).toBeDefined();
    // Including the successful sign-in, which is the response that carries a
    // session cookie and the user's id — the one a cached copy would give away.
    expect(res.headers?.["cache-control"]).toBe("no-store");
  }
});

test("H10: an authenticated session request returns the user", async () => {
  const { session, userId } = await signedIn();

  const res = await sessionHandler()(
    req("GET", { cookies: { [SESSION_COOKIE]: session } }),
  );

  expect(res.status).toBe(200);
  expect(userIdOf(res)).toBe(userId);
  // Re-sent so the one-hour cookie keeps sliding while the user is active.
  expect(setCookie(res, SESSION_COOKIE)).toContain("Max-Age=3600");
});

test("H11: a request with no session cookie is 401", async () => {
  const res = await sessionHandler()(bareReq("GET"));
  expect(res.status).toBe(401);
});

test("H12: a forged token is 401 and reads identically to no token", async () => {
  const handler = sessionHandler();
  const absent = await handler(bareReq("GET"));
  const forged = await handler(
    bareReq("GET", { cookies: { [SESSION_COOKIE]: "not-a-real-token" } }),
  );

  expect(forged.status).toBe(absent.status);
  // Distinguishing "expired" from "never existed" would tell an attacker
  // holding a guessed token that the guess was structurally right.
  expect(forged.body).toEqual(absent.body);
});

test("H13: sign-out without a csrf header is 403 and leaves the session alive", async () => {
  const { session, csrf } = await signedIn();

  const refused = await signOutHandler()(
    bareReq("POST", {
      cookies: { [SESSION_COOKIE]: session, [CSRF_COOKIE]: csrf },
    }),
  );

  expect(refused.status).toBe(403);
  expect(errorCode(refused)).toBe("CSRF_INVALID");

  // A CSRF failure that performed the action anyway would make the check
  // decorative — the status would be right and the effect would be wrong.
  const still = await sessionHandler()(
    req("GET", { cookies: { [SESSION_COOKIE]: session } }),
  );
  expect(still.status).toBe(200);
});

test("H14: sign-out with a matching token is 204 and clears both cookies", async () => {
  const { session, csrf } = await signedIn();

  const res = await signOutHandler()(
    req("POST", {
      cookies: { [SESSION_COOKIE]: session, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    }),
  );

  expect(res.status).toBe(204);
  expect(setCookie(res, SESSION_COOKIE)).toContain("Max-Age=0");
  expect(setCookie(res, CSRF_COOKIE)).toContain("Max-Age=0");
  // Attributes must match the ones used when setting, or the browser keeps the
  // original and the sign-out is cosmetic.
  expect(setCookie(res, SESSION_COOKIE)).toContain("HttpOnly");
  expect(setCookie(res, CSRF_COOKIE)).not.toContain("HttpOnly");
});

test("H15: after signing out the session no longer resolves", async () => {
  const { session, csrf } = await signedIn();

  await signOutHandler()(
    req("POST", {
      cookies: { [SESSION_COOKIE]: session, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    }),
  );

  const res = await sessionHandler()(
    req("GET", { cookies: { [SESSION_COOKIE]: session } }),
  );
  expect(res.status).toBe(401);

  // And the row is gone, not merely unresolvable.
  expect(await prisma.session.count()).toBe(0);
});

test("H16: a csrf token from another session still passes the check", async () => {
  const a = await signedIn();
  const b = await signedIn();

  const res = await signOutHandler()(
    req("POST", {
      cookies: { [SESSION_COOKIE]: a.session, [CSRF_COOKIE]: b.csrf },
      headers: { [CSRF_HEADER]: b.csrf },
    }),
  );

  // Asserted as it actually is, not as one might wish. Double-submit proves the
  // caller could READ a cookie on our origin; it proves nothing about WHICH
  // session that cookie belongs to, because the token is stateless and is never
  // compared against the session.
  //
  // The practical exposure is small — an attacker who can plant their own csrf
  // cookie on our origin already has a foothold there — but the stronger
  // construction binds the token to the session (an HMAC of the session id
  // under a server key). Recorded as follow-up, B-20260912-02.
  //
  // This test exists so that change is visible when it lands rather than
  // arriving as an unexplained behaviour difference.
  expect(res.status).toBe(204);
});

test("H17: signing out when not signed in is still 204", async () => {
  const { csrf } = await signedIn();

  const res = await signOutHandler()(
    req("POST", {
      cookies: { [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    }),
  );

  // Idempotent. "You were not signed in" is useless to a caller and is a small
  // oracle about whose cookie is live.
  expect(res.status).toBe(204);
});

test("H18: registering returns 201 and creates a user with no membership", async () => {
  const email = newEmail();

  const res = await registerHandler()(
    req("POST", { body: { email, password: PASSWORD, name: "Ada" } }),
  );

  expect(res.status).toBe(201);
  const userId = userIdOf(res);
  // A brand-new account that could already reach an organization would be a
  // tenancy hole open by default.
  expect(await prisma.membership.count({ where: { userId } })).toBe(0);
  // And it is not signed in: no cookies come back.
  expect(res.cookies ?? []).toHaveLength(0);
});

test("H19: registering the same email twice is 409", async () => {
  const email = newEmail();
  const handler = registerHandler();

  expect(
    (await handler(req("POST", { body: { email, password: PASSWORD } })))
      .status,
  ).toBe(201);

  const second = await handler(
    req("POST", { body: { email, password: PASSWORD } }),
  );
  expect(second.status).toBe(409);
  expect(errorCode(second)).toBe("AUTH_EMAIL_TAKEN");
});

test("H20: a short password is refused and creates no user row", async () => {
  const email = newEmail();

  // hashPassword throws a RangeError, and toErrorResponse RETHROWS anything it
  // does not recognise rather than flattening a bug into a tidy 500 body.
  await expect(
    registerHandler()(req("POST", { body: { email, password: "short" } })),
  ).rejects.toThrow();

  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

test("H21: the fourth registration from one address is 429", async () => {
  const handler = registerHandler();
  const ip = "198.51.100.9";

  for (let i = 0; i < 3; i += 1) {
    const res = await handler(
      req("POST", { body: { email: newEmail(), password: PASSWORD }, ip }),
    );
    expect(res.status).toBe(201);
  }

  const blocked = await handler(
    req("POST", { body: { email: newEmail(), password: PASSWORD }, ip }),
  );
  expect(blocked.status).toBe(429);
  expect(blocked.headers?.["retry-after"]).toBeDefined();
});

test("H22: an Origin from another site is refused when one is configured", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler({ expectedOrigin: ORIGIN })(
    req("POST", {
      body: { email, password: PASSWORD },
      headers: { origin: "https://evil.test" },
    }),
  );

  expect(res.status).toBe(403);
  expect(errorCode(res)).toBe("CSRF_INVALID");
  expect(res.cookies ?? []).toHaveLength(0);
});

test("H23: a missing Origin is allowed even when one is configured", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler({ expectedOrigin: ORIGIN })(
    req("POST", { body: { email, password: PASSWORD } }),
  );

  // Absence is not evidence of an attack: non-browser callers and some
  // same-origin requests omit Origin entirely. Refusing them would break real
  // traffic to close nothing, since a hostile page cannot suppress the header.
  expect(res.status).toBe(200);
});

test("H24: a matching Origin is allowed", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler({ expectedOrigin: ORIGIN })(
    req("POST", {
      body: { email, password: PASSWORD },
      headers: { origin: ORIGIN },
    }),
  );

  expect(res.status).toBe(200);
});

test("H25: sign-in without a csrf pair is 403 and sets no cookies", async () => {
  // This is what closes login CSRF (`B-20260912-01`). Before the middleware
  // issued a token on the sign-in PAGE, this request could not be checked at
  // all -- the cookie was issued by the sign-in RESPONSE, so there was nothing
  // to submit twice.
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler()(
    bareReq("POST", { body: { email, password: PASSWORD } }),
  );

  expect(res.status).toBe(403);
  expect(errorCode(res)).toBe("CSRF_INVALID");
  // The credentials were correct. A 403 that still handed back a session would
  // mean the check ran and changed nothing.
  expect(res.cookies ?? []).toHaveLength(0);
  expect(await prisma.session.count()).toBe(0);
});

test("H26: sign-in with a mismatched csrf pair is 403", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler()(
    bareReq("POST", {
      body: { email, password: PASSWORD },
      cookies: { [CSRF_COOKIE]: "one-value" },
      headers: { [CSRF_HEADER]: "a-different-value" },
    }),
  );

  expect(res.status).toBe(403);
  expect(await prisma.session.count()).toBe(0);
});

test("H27: registration without a csrf pair is 403 and creates no user", async () => {
  const email = newEmail();

  const res = await registerHandler()(
    bareReq("POST", { body: { email, password: PASSWORD } }),
  );

  expect(res.status).toBe(403);
  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

test("H28: the csrf failure body never says which half was wrong", async () => {
  // Telling a probe whether the cookie or the header was missing tells it which
  // half of the double-submit to work on next. All three read identically.
  const bodies = await Promise.all(
    [
      bareReq("POST", { body: {} }),
      bareReq("POST", { body: {}, cookies: { [CSRF_COOKIE]: CSRF } }),
      bareReq("POST", { body: {}, headers: { [CSRF_HEADER]: CSRF } }),
    ].map(async (r) => {
      const res = await signInHandler()(r);
      expect(res.status).toBe(403);
      return JSON.stringify(res.body);
    }),
  );

  expect(new Set(bodies).size).toBe(1);
});

test("H29: signing in ROTATES the csrf token", async () => {
  // Found by running the whole flow with curl: a client holding the token from
  // the sign-in PAGE and reusing it after sign-in gets a 403, because the
  // sign-in response issued a new one.
  //
  // The rotation is correct and worth keeping — reissuing on a privilege change
  // is what stops a token planted before authentication from remaining valid
  // after it. But it means any client caching the value at render time breaks
  // the first request it makes afterwards, which is precisely why
  // `MemberAdmin` and `NewOrganization` read the cookie at CALL time.
  //
  // Pinned so that removing the rotation is a deliberate decision rather than a
  // tidy-up, and so the call-time reads have a stated reason to exist.
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const res = await signInHandler()(
    req("POST", { body: { email, password: PASSWORD } }),
  );

  expect(res.status).toBe(200);
  const issued = cookieValue(res, CSRF_COOKIE);
  expect(issued).not.toBe(CSRF);
  expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

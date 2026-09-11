import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup.js";
import { registerUser } from "../../../src/server/auth/session.js";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "../../../src/server/http/cookies.js";
import type { HttpRequest } from "../../../src/server/http/types.js";
import { json, noContent } from "../../../src/server/http/types.js";
import {
  DEFAULT_MAX_BODY_BYTES,
  PayloadTooLargeError,
  UnsupportedMethodError,
  clientIp,
  toHttpRequest,
  toResponse,
  toRouteHandler,
} from "../../../src/server/http/adapters/web.js";
import {
  signInHandler,
  signOutHandler,
} from "../../../src/server/http/handlers/auth.js";

/**
 * The adapter, exercised through real `Request` and `Response` objects. Node 22
 * provides both, so this needs no framework and no server — which is the whole
 * claim the layer makes.
 */

const PASSWORD = "correct horse battery staple";
const URL_BASE = "https://books.example.com";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

function request(
  method: string,
  init?: { path?: string; headers?: Record<string, string>; body?: unknown },
): Request {
  const hasBody = init?.body !== undefined;
  return new Request(`${URL_BASE}${init?.path ?? "/api/auth/signin"}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Every Set-Cookie line, which is what `getSetCookie` exists to recover. */
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

test("A1: a request narrows to the plain shape the handlers expect", async () => {
  const req = await toHttpRequest(
    request("POST", {
      path: "/api/auth/signin",
      headers: { "x-csrf-token": "abc", cookie: "__Host-csrf=abc; other=1" },
      body: { email: "a@b.test", password: PASSWORD },
    }),
  );

  expect(req.method).toBe("POST");
  expect(req.path).toBe("/api/auth/signin");
  expect(req.headers["x-csrf-token"]).toBe("abc");
  expect(req.cookies[CSRF_COOKIE]).toBe("abc");
  expect(req.body).toEqual({ email: "a@b.test", password: PASSWORD });
});

test("A2: header names arrive lowercased whatever case they were sent in", async () => {
  // The rest of the layer reads `headers["x-csrf-token"]` directly. If the
  // adapter passed `X-CSRF-Token` through unchanged, the CSRF check would see
  // no header and refuse every mutation from a client that capitalises.
  const req = await toHttpRequest(
    request("POST", { headers: { "X-CSRF-Token": "abc", Origin: URL_BASE } }),
  );

  expect(req.headers["x-csrf-token"]).toBe("abc");
  expect(req.headers["origin"]).toBe(URL_BASE);
});

test("A3: an unparseable body becomes undefined, not an exception", async () => {
  // A malformed body must produce a 400 from the handler's own validation, not
  // a 500 from the adapter. `readCredentials` already refuses undefined.
  const req = await toHttpRequest(
    new Request(`${URL_BASE}/api/auth/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
  );

  expect(req.body).toBeUndefined();
});

test("A4: an empty body is not an error", async () => {
  // The ordinary case for a DELETE. `json()` throws on an empty body, so an
  // adapter that let that propagate would 500 on every bodyless mutation.
  const req = await toHttpRequest(
    new Request(`${URL_BASE}/api/session`, { method: "DELETE" }),
  );

  expect(req.body).toBeUndefined();
  expect(req.method).toBe("DELETE");
});

test("A5: an unsupported method is refused rather than widened", async () => {
  // A cast would let an invented verb through, and `isMutating` answers false
  // for anything it does not recognise — so the request would skip CSRF
  // entirely while still carrying the session cookie.
  await expect(
    toHttpRequest(new Request(`${URL_BASE}/x`, { method: "OPTIONS" })),
  ).rejects.toBeInstanceOf(UnsupportedMethodError);
});

test("A6: x-forwarded-for is ignored unless it is explicitly trusted", async () => {
  // The header is client-set unless a proxy overwrites it. Believing it by
  // default gives an attacker a fresh rate-limit counter per request, which is
  // an unlimited budget of password guesses against a limiter that looks like
  // it is working.
  const req = request("POST", { headers: { "x-forwarded-for": "198.51.100.1" } });

  expect(clientIp(req)).toBeUndefined();
  expect(clientIp(req, {})).toBeUndefined();
  expect(clientIp(req, { trustForwardedFor: false })).toBeUndefined();
  expect(clientIp(req, { trustForwardedFor: true })).toBe("198.51.100.1");
});

test("A7: the FIRST forwarded entry is the client, not the last", async () => {
  // A trusted proxy appends itself. Taking the last would return our own
  // proxy's address for every request in the world, collapsing every client
  // onto one shared counter — worse than having none.
  const req = request("POST", {
    headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.7, 10.0.0.1" },
  });

  expect(clientIp(req, { trustForwardedFor: true })).toBe("198.51.100.1");
});

test("A8: a blank or absent forwarded header yields no address", async () => {
  const config = { trustForwardedFor: true } as const;
  expect(clientIp(request("POST"), config)).toBeUndefined();
  expect(
    clientIp(request("POST", { headers: { "x-forwarded-for": "  " } }), config),
  ).toBeUndefined();
  expect(
    clientIp(request("POST", { headers: { "x-forwarded-for": " , 1.2.3.4" } }), config),
  ).toBeUndefined();
});

test("A9: two cookies survive as two Set-Cookie headers", async () => {
  // `set` would collapse them and the browser would keep one. A user would
  // then hold a session and no CSRF token, and every mutation would 403.
  const res = toResponse(
    json(200, { ok: true }, { cookies: ["a=1; Path=/", "b=2; Path=/"] }),
  );

  expect(setCookies(res)).toEqual(["a=1; Path=/", "b=2; Path=/"]);
});

test("A10: a 204 carries no body", async () => {
  const res = toResponse(noContent({ cookies: ["a=; Max-Age=0"] }));
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
});

test("A11: a body is serialised as JSON", async () => {
  const res = toResponse(json(200, { userId: "u1" }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  expect(await res.json()).toEqual({ userId: "u1" });
});

test("A12: the wrapped route handler signs a real user in end to end", async () => {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);
  const route = toRouteHandler(signInHandler());

  const res = await route(
    request("POST", { body: { email, password: PASSWORD } }),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ userId });

  const cookies = setCookies(res);
  expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=`))).toBe(true);
  expect(res.headers.get("x-frame-options")).toBe("DENY");
});

test("A13: the cookies the adapter emits are the ones it can read back", async () => {
  // The round trip that matters: whatever sign-in sets must parse back into the
  // shape the next request's CSRF check reads. A serialisation the parser
  // cannot recover would pass both units and fail in a browser.
  const email = newEmail();
  await registerUser(email, PASSWORD);

  const signedIn = await toRouteHandler(signInHandler())(
    request("POST", { body: { email, password: PASSWORD } }),
  );
  const cookieHeader = setCookies(signedIn)
    .map((line) => line.slice(0, line.indexOf(";")))
    .join("; ");

  const next = await toHttpRequest(
    request("POST", { headers: { cookie: cookieHeader } }),
  );

  const csrf = next.cookies[CSRF_COOKIE];
  expect(typeof next.cookies[SESSION_COOKIE]).toBe("string");
  expect(typeof csrf).toBe("string");

  // And it is accepted as the other half of a double submit.
  const out = await toRouteHandler(signOutHandler())(
    request("POST", {
      path: "/api/auth/signout",
      headers: { cookie: cookieHeader, "x-csrf-token": csrf ?? "" },
    }),
  );
  expect(out.status).toBe(204);
});

test("A14: an unsupported method reaches the client as 405, not 500", async () => {
  const res = await toRouteHandler(signInHandler())(
    new Request(`${URL_BASE}/api/auth/signin`, { method: "OPTIONS" }),
  );

  expect(res.status).toBe(405);
  expect(await res.json()).toEqual({
    error: { code: "METHOD_NOT_SUPPORTED", message: "unsupported method" },
  });
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

test("A15: an unrecognised exception becomes a generic 500", async () => {
  // `toErrorResponse` rethrows what it does not recognise so that bugs are not
  // dressed up as handled errors. They have to stop somewhere, and the message
  // must not carry the detail — an exception routinely names a column, a file
  // or a constraint.
  const exploding = async (_req: HttpRequest): Promise<never> => {
    throw new Error("relation \"secret_table\" does not exist");
  };

  const res = await toRouteHandler(exploding)(request("POST", { body: {} }));

  expect(res.status).toBe(500);
  const body: unknown = await res.json();
  expect(body).toEqual({
    error: { code: "INTERNAL", message: "internal error" },
  });
  expect(JSON.stringify(body)).not.toContain("secret_table");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
});

test("A16: a trusted address reaches the rate limiter as the counter key", async () => {
  // End to end rather than by inspection: with the header trusted, the sixth
  // attempt from one address is refused even though each attempt names a
  // different account.
  const route = toRouteHandler(signInHandler(), { trustForwardedFor: true });
  const headers = { "x-forwarded-for": "198.51.100.44" };

  for (let i = 0; i < 5; i += 1) {
    const res = await route(
      request("POST", { headers, body: { email: newEmail(), password: PASSWORD } }),
    );
    expect(res.status).toBe(401);
  }

  const blocked = await route(
    request("POST", { headers, body: { email: newEmail(), password: PASSWORD } }),
  );
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBe("1");
});

test("A18: a body over the limit is refused, not buffered", async () => {
  // Found by independent review. Without a ceiling, `json()` buffers whatever
  // the client sends before anything can reject it: one connection streaming a
  // gigabyte costs the server a gigabyte and costs the attacker nothing.
  const huge = "x".repeat(DEFAULT_MAX_BODY_BYTES + 1);

  await expect(
    toHttpRequest(
      new Request(`${URL_BASE}/api/auth/signin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.test", password: huge }),
      }),
    ),
  ).rejects.toBeInstanceOf(PayloadTooLargeError);
});

test("A19: the limit counts bytes received, not the declared length", async () => {
  // A client is free to declare a small `content-length` and send more, and a
  // chunked request declares none at all. The only count that means anything is
  // taken over the bytes actually read, while they are being read.
  const body = "y".repeat(2048);
  const lying = new Request(`${URL_BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "10" },
    body: JSON.stringify({ padding: body }),
  });

  await expect(
    toHttpRequest(lying, { maxBodyBytes: 512 }),
  ).rejects.toBeInstanceOf(PayloadTooLargeError);
});

test("A20: an oversized body reaches the client as 413, not 500", async () => {
  const route = toRouteHandler(signInHandler(), { maxBodyBytes: 64 });

  const res = await route(
    request("POST", {
      body: { email: "a@b.test", password: "z".repeat(200) },
    }),
  );

  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({
    error: { code: "PAYLOAD_TOO_LARGE", message: "request body too large" },
  });
});

test("A21: a body just under the limit is accepted normally", async () => {
  const req = await toHttpRequest(
    request("POST", { body: { note: "a".repeat(100) } }),
    { maxBodyBytes: 1024 },
  );

  expect(req.body).toEqual({ note: "a".repeat(100) });
});

test("A22: a null-body status never gets a body, whatever the handler says", async () => {
  // `Response` does not IGNORE a body on a 204 — it throws. So a handler that
  // ever returned `{ status: 204, body: null }` would turn a correct 204 into
  // an unhandled exception and then a 500, three layers from the cause.
  for (const status of [204, 205, 304]) {
    const res = toResponse({ status, body: null });
    expect(res.status).toBe(status);
    expect(await res.text()).toBe("");
  }
});

test("A17: untrusted, the same flood is not throttled by address", async () => {
  // The other half of A16, and the reason the default is what it is. Without a
  // trusted proxy the address dimension contributes nothing, so six attempts
  // against six DIFFERENT accounts are six independent counters and none trips.
  // That is the honest consequence of refusing to believe a forgeable header —
  // the account dimension is what still works.
  const route = toRouteHandler(signInHandler());
  const headers = { "x-forwarded-for": "198.51.100.44" };

  for (let i = 0; i < 6; i += 1) {
    const res = await route(
      request("POST", { headers, body: { email: newEmail(), password: PASSWORD } }),
    );
    expect(res.status).toBe(401);
  }
});

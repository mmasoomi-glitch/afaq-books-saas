import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  CSRF_COOKIE,
  CSRF_COOKIE_OPTIONS,
} from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";

/**
 * `src/middleware.ts` DUPLICATES three constants instead of importing them, and
 * it has to: middleware runs on the Edge runtime, and importing
 * `src/server/http/cookies` would pull the Prisma and argon2 dependency graph
 * in with it, which cannot run there.
 *
 * Duplication that nothing checks is duplication that drifts. If the cookie
 * were ever renamed in one place only, the middleware would set `__Host-csrf`
 * while the handler looked for something else — every submission would 403,
 * and the failure would look like a CSRF bug rather than a rename.
 *
 * These assert the SOURCE TEXT rather than importing the module, deliberately:
 * importing it would require `next/server` and an Edge-ish environment in the
 * test runner, which is a lot of machinery to check three strings.
 */

const SOURCE = readFileSync(
  resolve(process.cwd(), "src", "middleware.ts"),
  "utf8",
);

test("M1: the middleware uses the same cookie name as the handlers", () => {
  expect(SOURCE).toContain(`const CSRF_COOKIE = "${CSRF_COOKIE}"`);
});

test("M2: the middleware uses the same header name the CSRF check reads", () => {
  expect(SOURCE).toContain(`const CSRF_HEADER = "${CSRF_HEADER}"`);
});

test("M3: the middleware issues the same lifetime the handlers do", () => {
  expect(SOURCE).toContain(
    `const CSRF_MAX_AGE_SECONDS = ${String(CSRF_COOKIE_OPTIONS.maxAgeSeconds)}`,
  );
});

test("M4: the cookie it sets keeps every attribute the __Host- prefix requires", () => {
  // A browser REFUSES a `__Host-` cookie that lacks `Secure`, lacks `Path=/`,
  // or carries a `Domain`. Dropping one would not error anywhere — the cookie
  // would simply never be stored, and sign-in would fail in a browser while
  // passing every test that does not involve one.
  expect(SOURCE).toContain("secure: true");
  expect(SOURCE).toContain('path: "/"');
  expect(SOURCE).not.toContain("domain:");
});

test("M5: the csrf cookie is not HttpOnly", () => {
  // Double-submit needs page JavaScript to read it. Setting HttpOnly here would
  // look like hardening and would make every mutation impossible to authorise.
  expect(SOURCE).toContain("httpOnly: false");
  expect(CSRF_COOKIE_OPTIONS.httpOnly).toBe(false);
});

test("M6: the matcher never covers an API route", () => {
  // The API endpoints VERIFY the token. If the middleware also issued one to
  // them, the check would be comparing a value against a cookie the same
  // request had just been handed — it would pass for everyone, including an
  // attacker, and look exactly like a working control.
  const matcher = /export const config = \{ matcher: \[([^\]]*)\] \}/.exec(SOURCE);
  expect(matcher).not.toBeNull();

  const routes = matcher?.[1] ?? "";
  expect(routes).not.toContain("/api");
  expect(routes).not.toContain(":path*");
  expect(routes).toContain("/signin");
});

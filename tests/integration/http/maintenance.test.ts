import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../../src/server/http/types";
import {
  MAINTENANCE_HEADER,
  reapHandler,
} from "../../../src/server/http/handlers/maintenance";

/**
 * The maintenance reaper.
 *
 * Nothing removed expired `rate_limits` rows, and the table just started
 * growing faster: authenticated writes are now limited, which adds a row per
 * user per minute window.
 */

/**
 * Generated per run rather than written as a literal.
 *
 * A high-entropy string assigned to a constant called SECRET is exactly the
 * shape of a leaked credential, and the `gitleaks` gate flagged the literal
 * this replaced — correctly. The fix is not an allowlist entry: an allowlist
 * teaches the next person that flagged findings are something you silence.
 *
 * Generating it also makes the test slightly better. A fixed string could in
 * principle be the value the code compares against; a fresh one each run
 * cannot be.
 */
const SECRET = randomUUID();

beforeEach(async () => {
  await resetDb();
  process.env["MAINTENANCE_SECRET"] = SECRET;
});

afterEach(() => {
  delete process.env["MAINTENANCE_SECRET"];
});

function req(method: HttpMethod, secret?: string): HttpRequest {
  return {
    method,
    path: "/api/maintenance/reap",
    headers: secret === undefined ? {} : { [MAINTENANCE_HEADER]: secret },
    cookies: {},
  };
}

function bodyOf(res: HttpResponse): Record<string, unknown> {
  const body = res.body;
  if (typeof body !== "object" || body === null) {
    throw new Error(`expected an object body, got ${String(body)}`);
  }
  return { ...body } as Record<string, unknown>;
}

/** One expired counter and one live one. */
async function seed(): Promise<{ liveKey: string }> {
  const now = Date.now();
  await prisma.rateLimit.create({
    data: {
      key: `expired-${randomUUID()}`,
      count: 1,
      windowStart: new Date(now - 120_000),
      expiresAt: new Date(now - 60_000),
    },
  });
  const liveKey = `live-${randomUUID()}`;
  await prisma.rateLimit.create({
    data: {
      key: liveKey,
      count: 1,
      windowStart: new Date(now),
      expiresAt: new Date(now + 60_000),
    },
  });
  return { liveKey };
}

test("M1: the right secret reaps expired counters and leaves live ones", async () => {
  const { liveKey } = await seed();

  const res = await reapHandler()(req("POST", SECRET));

  expect(res.status).toBe(200);
  expect(bodyOf(res)["removed"]).toBe(1);
  expect(
    await prisma.rateLimit.findUnique({ where: { key: liveKey } }),
  ).not.toBeNull();
});

test("M2: the count is returned, not just 'ok'", async () => {
  // A maintenance endpoint that always answers "ok" is indistinguishable from
  // one that silently stopped working. The number is what makes the
  // scheduler's own logs worth reading.
  await seed();
  await seed();

  const res = await reapHandler()(req("POST", SECRET));

  expect(bodyOf(res)["removed"]).toBe(2);

  // And a second call removes nothing, which is the signal that it worked.
  expect(bodyOf(await reapHandler()(req("POST", SECRET)))["removed"]).toBe(0);
});

test("M3: a wrong secret is 404 and reaps nothing", async () => {
  const { liveKey } = await seed();

  const res = await reapHandler()(req("POST", "not the secret"));

  expect(res.status).toBe(404);
  expect(await prisma.rateLimit.count()).toBe(2);
  expect(
    await prisma.rateLimit.findUnique({ where: { key: liveKey } }),
  ).not.toBeNull();
});

test("M4: no secret at all is 404", async () => {
  await seed();

  const res = await reapHandler()(req("POST"));

  expect(res.status).toBe(404);
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M5: an UNCONFIGURED server answers exactly like a wrong secret", async () => {
  // The property. 503 "not configured" would be more helpful to an operator
  // and would tell an attacker whether this deployment has maintenance set up
  // — a fact about our operational maturity they have no business having. The
  // operator gets a server-side warning instead.
  delete process.env["MAINTENANCE_SECRET"];
  await seed();

  const unconfigured = await reapHandler()(req("POST", SECRET));

  process.env["MAINTENANCE_SECRET"] = SECRET;
  const wrongSecret = await reapHandler()(req("POST", "wrong"));

  expect(unconfigured.status).toBe(404);
  expect(unconfigured.status).toBe(wrongSecret.status);
  expect(unconfigured.body).toEqual(wrongSecret.body);
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M6: an empty configured secret does not become a skeleton key", async () => {
  // The failure this guards: `MAINTENANCE_SECRET=""` in a .env file is a very
  // easy thing to end up with, and a naive comparison would then match a
  // request that sends nothing.
  process.env["MAINTENANCE_SECRET"] = "";
  await seed();

  expect((await reapHandler()(req("POST", ""))).status).toBe(404);
  expect((await reapHandler()(req("POST"))).status).toBe(404);
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M7: GET is refused even with the right secret", async () => {
  // It changes state. A GET would also be fetched by any crawler or link
  // preview that found the URL.
  await seed();

  const res = await reapHandler()(req("GET", SECRET));

  expect(res.status).toBe(405);
  expect(res.headers?.["allow"]).toBe("POST");
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M8: audit_logs are never touched", async () => {
  // Deliberate, and the reason B-20260913-02 stays open. The table is
  // append-only by trigger and deleting from it would contradict the reason it
  // exists; retention there means archiving to colder storage, which is a
  // decision rather than a job.
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Acme" },
  });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test` },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      actorId: user.id,
      action: "test.old",
      entityType: "Test",
      entityId: randomUUID(),
    },
  });
  await seed();

  await reapHandler()(req("POST", SECRET));

  expect(await prisma.auditLog.count()).toBe(1);
});

test("M9: a WHITESPACE-ONLY configured secret is not a skeleton key either", async () => {
  // Found by a Forge review of the handler, and it was right: whitespace is
  // neither `undefined` nor `""`, so the original empty-string guard let it
  // through and a caller sending the same whitespace would have been
  // authorised. The guard is now a length floor after trimming, which covers
  // this without a second special case.
  process.env["MAINTENANCE_SECRET"] = "   ";
  await seed();

  expect((await reapHandler()(req("POST", "   "))).status).toBe(404);
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M10: a secret shorter than the floor is refused even when it matches", async () => {
  // Nothing rate-limits this route, so a short secret can be guessed at
  // whatever speed the network allows. Refusing it is louder than hoping the
  // operator chose well.
  process.env["MAINTENANCE_SECRET"] = "hunter2";
  await seed();

  expect((await reapHandler()(req("POST", "hunter2"))).status).toBe(404);
  expect(await prisma.rateLimit.count()).toBe(2);
});

test("M11: surrounding whitespace on the configured secret fails CLOSED", async () => {
  // Documented rather than fixed. Trimming the configured value would make the
  // comparison inexact, so a `.env` with a trailing space refuses the caller
  // that sends the trimmed value — which is the safe direction, and the
  // handler logs a warning saying exactly that, because otherwise the operator
  // sees only a 404 they cannot explain.
  process.env["MAINTENANCE_SECRET"] = `${SECRET} `;
  await seed();

  expect((await reapHandler()(req("POST", SECRET))).status).toBe(404);
  expect((await reapHandler()(req("POST", `${SECRET} `))).status).toBe(200);
});

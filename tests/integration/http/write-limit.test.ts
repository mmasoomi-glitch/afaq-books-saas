import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser, signIn } from "../../../src/server/auth/session";
import { createOrganization } from "../../../src/server/auth/membership";
import { POLICIES } from "../../../src/server/auth/rate-limit";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../../src/server/http/types";
import { withOrgScope } from "../../../src/server/http/handlers/scoped";
import { createAccountHandler } from "../../../src/server/http/handlers/ledger";
import { guardedListAccounts } from "../../../src/modules/ledger/guarded";
import { resolveOrgScope } from "../../../src/server/auth/scope";

/**
 * The per-user write limit.
 *
 * Not an authorization control — everyone it applies to is already a member
 * holding the permission for what they are doing. It is resource protection
 * against a runaway script or a compromised session, and it is enforced in
 * `withOrgScope` so a new endpoint cannot forget it.
 */

const PASSWORD = "correct horse battery staple";
const CSRF = "csrf-token-for-tests-0123456789";
const LIMIT = POLICIES.write.limit;

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

function req(
  method: HttpMethod,
  session: string,
  body?: unknown,
): HttpRequest {
  return {
    method,
    path: "/",
    headers: { [CSRF_HEADER]: CSRF },
    cookies: { [CSRF_COOKIE]: CSRF, [SESSION_COOKIE]: session },
    ...(body === undefined ? {} : { body }),
  };
}

function errorCode(res: HttpResponse): string {
  const body = res.body;
  if (typeof body !== "object" || body === null) return "";
  const wrapper = (body as Record<string, unknown>)["error"];
  if (typeof wrapper !== "object" || wrapper === null) return "";
  const code = (wrapper as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : "";
}

async function owner() {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const { organizationId } = await createOrganization(userId, {
    slug,
    name: "Acme",
  });
  const { rawToken } = await signIn(email, PASSWORD);
  return { userId, slug, organizationId, token: rawToken };
}

/** Spend `n` of a user's write budget without doing `n` real writes. */
async function burn(userId: string, n: number): Promise<void> {
  const now = new Date();
  await prisma.rateLimit.upsert({
    where: { key: `write:account:${userId}` },
    create: {
      key: `write:account:${userId}`,
      count: n,
      windowStart: now,
      expiresAt: new Date(now.getTime() + POLICIES.write.windowMs),
    },
    update: { count: n },
  });
}

test("W1: a write under the limit is not affected", async () => {
  const o = await owner();

  const res = await withOrgScope(o.slug, createAccountHandler())(
    req("POST", o.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );

  expect(res.status).toBe(201);
});

test("W2: the write past the limit is 429 with a retry-after", async () => {
  const o = await owner();
  await burn(o.userId, LIMIT);

  const res = await withOrgScope(o.slug, createAccountHandler())(
    req("POST", o.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );

  expect(res.status).toBe(429);
  expect(errorCode(res)).toBe("AUTH_RATE_LIMITED");
  expect(res.headers?.["retry-after"]).toBeDefined();
});

test("W3: a refused write does not happen", async () => {
  // The half that matters. A limiter that returns 429 and performs the write
  // anyway is a limiter that reports a refusal it did not make.
  const o = await owner();
  await burn(o.userId, LIMIT);

  await withOrgScope(o.slug, createAccountHandler())(
    req("POST", o.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );

  expect(
    await prisma.account.count({ where: { organizationId: o.organizationId } }),
  ).toBe(0);
});

test("W4: READS are not limited", async () => {
  // Deliberate. Reads are cheap, they are the bulk of normal use, and a report
  // that refuses to render because somebody refreshed it is a worse failure
  // than the one being prevented.
  const o = await owner();
  await burn(o.userId, LIMIT * 10);

  const scope = await resolveOrgScope(o.userId, o.slug);
  await expect(guardedListAccounts(scope)).resolves.toBeDefined();
});

test("W5: the budget is per user, not per organization", async () => {
  // One user exhausting their budget must not stop a colleague working. Keyed
  // on the user precisely so a shared organization is not a shared failure.
  const a = await owner();
  const b = await owner();
  await burn(a.userId, LIMIT);

  const refused = await withOrgScope(a.slug, createAccountHandler())(
    req("POST", a.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );
  expect(refused.status).toBe(429);

  const allowed = await withOrgScope(b.slug, createAccountHandler())(
    req("POST", b.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );
  expect(allowed.status).toBe(201);
});

test("W6: exhausting the budget in one organization stops you in another", async () => {
  // The other side of keying on the user: the limit follows the person, not
  // the tenant. A compromised session cannot be laundered by switching
  // organizations, which is the point.
  const a = await owner();

  const second = `org-${randomUUID().slice(0, 8)}`;
  await createOrganization(a.userId, { slug: second, name: "Second" });
  await burn(a.userId, LIMIT);

  const res = await withOrgScope(second, createAccountHandler())(
    req("POST", a.token, {
      code: "1000",
      name: "Cash",
      type: "ASSET",
      currency: "USD",
    }),
  );

  expect(res.status).toBe(429);
});

test("W7: the limit is generous enough that no interface reaches it", async () => {
  // Pinned as a number rather than left to drift. 300 a minute is five a
  // second sustained: no human, no form, and every runaway loop.
  expect(POLICIES.write.limit).toBe(300);
  expect(POLICIES.write.windowMs).toBe(60_000);
});

test("W8: an unauthenticated write is still 404, not 429", async () => {
  // Order matters. The scope resolves BEFORE the limiter runs, so an
  // unauthenticated caller learns nothing about whether the organization
  // exists — and cannot spend somebody else's budget by guessing a slug.
  const o = await owner();
  await burn(o.userId, LIMIT);

  const res = await withOrgScope(o.slug, createAccountHandler())({
    method: "POST",
    path: "/",
    headers: { [CSRF_HEADER]: CSRF },
    cookies: { [CSRF_COOKIE]: CSRF },
    body: { code: "1000", name: "Cash", type: "ASSET", currency: "USD" },
  });

  expect(res.status).toBe(404);
});

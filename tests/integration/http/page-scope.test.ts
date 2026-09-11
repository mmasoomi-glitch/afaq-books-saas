import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { SESSION_COOKIE } from "../../../src/server/http/cookies";
import { registerUser, signIn } from "../../../src/server/auth/session";

/**
 * `requirePageScope` is where a rendered page gets its authorization, and the
 * property that matters is not "does it work" but "do its four failure modes
 * look the same from outside".
 *
 * `next/headers` and `next/navigation` are mocked because they require a Next
 * request context that does not exist in a test runner. Everything BEHIND them
 * — the session lookup, the membership re-resolution, the org lookup — runs
 * against the real database, so what is faked here is only the transport of a
 * cookie value and the signalling of a redirect.
 *
 * `redirect()` and `notFound()` are mocked as THROWING, which is what they
 * really do. Mocking them as returning would let a bug through: code after a
 * redirect would run in the test and not in production.
 */

const REDIRECTED = "next-redirect";
const NOT_FOUND = "next-not-found";

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      // Compared against the real constant, so a rename of the cookie breaks
      // this mock loudly instead of leaving it silently matching nothing —
      // which would make every test here take the "no session" path and still
      // pass four of the seven.
      get: (name: string) =>
        name === SESSION_COOKIE && cookieValue !== undefined
          ? { name, value: cookieValue }
          : undefined,
    }),
}));

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error(REDIRECTED);
  },
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const { requirePageScope, optionalPageScope } = await import(
  "../../../src/server/http/page-scope"
);

const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDb();
  cookieValue = undefined;
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

/** A user, an organization, and optionally a membership joining them. */
async function setup(withMembership: boolean): Promise<{
  slug: string;
  token: string;
  userId: string;
}> {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Test" },
  });
  if (withMembership) {
    await prisma.membership.create({
      data: { userId, organizationId: org.id, role: "VIEWER" },
    });
  }
  const { rawToken } = await signIn(email, PASSWORD);
  return { slug: org.slug, token: rawToken, userId };
}

async function outcome(slug: string): Promise<string> {
  try {
    const scope = await requirePageScope(slug);
    return `scope:${scope.organizationSlug}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test("P1: a member of the organization gets a scope", async () => {
  const { slug, token, userId } = await setup(true);
  cookieValue = token;

  const scope = await requirePageScope(slug);
  expect(scope.organizationSlug).toBe(slug);
  expect(scope.userId).toBe(userId);
  expect(scope.role).toBe("VIEWER");
});

test("P2: no session cookie redirects to sign-in rather than 404ing", async () => {
  // Not signing in is not an error, it is a visitor who has not signed in. And
  // this must NOT be caught by the handler that turns auth failures into 404s:
  // "please sign in" becoming "this does not exist" would look like a routing
  // bug and be an authorization one.
  const { slug } = await setup(true);
  cookieValue = undefined;

  expect(await outcome(slug)).toBe(REDIRECTED);
});

test("P3: an empty session cookie is treated as no cookie", async () => {
  const { slug } = await setup(true);
  cookieValue = "";

  expect(await outcome(slug)).toBe(REDIRECTED);
});

test("P4: all four authorization failures are indistinguishable", async () => {
  // The property `.claude/rules/security-tenancy.md` requires: another
  // organization's identifier returns 404, "not 200, not 403 with the body
  // leaking the existence". A 403 would confirm the organization exists and
  // that you are merely not in it, which makes the URL bar an enumeration
  // oracle over the customer list.
  //
  // "No such organization", "not a member", "session expired" and "no such
  // session" are four different facts. From outside they must be one answer.
  const member = await setup(true);

  // (a) organization does not exist
  cookieValue = member.token;
  const noSuchOrg = await outcome(`org-${randomUUID().slice(0, 8)}`);

  // (b) organization exists, user is not a member
  const stranger = await setup(false);
  cookieValue = stranger.token;
  const notAMember = await outcome(stranger.slug);

  // (c) session was valid and has been revoked
  const revoked = await setup(true);
  cookieValue = revoked.token;
  await prisma.session.deleteMany({});
  const noSuchSession = await outcome(revoked.slug);

  // (d) session exists but has expired
  const expired = await setup(true);
  cookieValue = expired.token;
  await prisma.session.updateMany({
    data: { expires: new Date(Date.now() - 1000) },
  });
  const sessionExpired = await outcome(expired.slug);

  expect(noSuchOrg).toBe(NOT_FOUND);
  expect(notAMember).toBe(NOT_FOUND);
  expect(noSuchSession).toBe(NOT_FOUND);
  expect(sessionExpired).toBe(NOT_FOUND);
  expect(new Set([noSuchOrg, notAMember, noSuchSession, sessionExpired]).size).toBe(1);
});

test("P5: revoking a membership takes effect on the next page load", async () => {
  // Membership is re-resolved on every call rather than cached into the
  // session. Without that, someone removed from an organization would keep
  // reading its books until their session happened to expire.
  const { slug, token, userId } = await setup(true);
  cookieValue = token;

  expect((await requirePageScope(slug)).organizationSlug).toBe(slug);

  const org = await prisma.organization.findFirstOrThrow({ where: { slug } });
  await prisma.membership.deleteMany({
    where: { userId, organizationId: org.id },
  });

  expect(await outcome(slug)).toBe(NOT_FOUND);
});

test("P6: optionalPageScope returns undefined instead of redirecting", async () => {
  const { slug, token } = await setup(true);

  cookieValue = undefined;
  expect(await optionalPageScope(slug)).toBeUndefined();

  cookieValue = token;
  expect((await optionalPageScope(slug))?.organizationSlug).toBe(slug);

  cookieValue = "not-a-real-token";
  expect(await optionalPageScope(slug)).toBeUndefined();
});

test("P7: one tenant's slug never resolves for another tenant's user", async () => {
  const a = await setup(true);
  const b = await setup(true);

  // A's token against B's organization.
  cookieValue = a.token;
  expect(await outcome(b.slug)).toBe(NOT_FOUND);

  // And the reverse, so the result is not an artefact of creation order.
  cookieValue = b.token;
  expect(await outcome(a.slug)).toBe(NOT_FOUND);
});

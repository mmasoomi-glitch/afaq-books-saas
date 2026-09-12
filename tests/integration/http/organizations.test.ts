import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser, signIn } from "../../../src/server/auth/session";
import { createOrganization } from "../../../src/server/auth/membership";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../../src/server/http/types";
import { withOrgScope, readString } from "../../../src/server/http/handlers/scoped";
import {
  changeRoleHandler,
  createOrganizationHandler,
  grantMemberHandler,
  removeMemberHandler,
  transferOwnershipHandler,
} from "../../../src/server/http/handlers/organizations";

/**
 * The endpoints, exercised as functions against a real database.
 *
 * The property that matters most here is the one `security-tenancy.md` states
 * as a test requirement: the organization is taken from the URL and never from
 * the body, and every authorization failure answers 404.
 */

const PASSWORD = "correct horse battery staple";
const CSRF = "csrf-token-for-tests-0123456789";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

function newSlug(): string {
  return `org-${randomUUID().slice(0, 8)}`;
}

function req(
  method: HttpMethod,
  over?: Partial<HttpRequest> & { session?: string },
): HttpRequest {
  const { session, ...rest } = over ?? {};
  return {
    method,
    path: "/",
    ...rest,
    headers: { [CSRF_HEADER]: CSRF, ...over?.headers },
    cookies: {
      [CSRF_COOKIE]: CSRF,
      ...(session === undefined ? {} : { [SESSION_COOKIE]: session }),
      ...over?.cookies,
    },
  };
}

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
    throw new Error("no error object in body");
  }
  const code = (wrapper as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : "";
}

/** A registered, signed-in user. */
async function signedIn(): Promise<{ userId: string; token: string; email: string }> {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const { rawToken, userId } = await signIn(email, PASSWORD);
  return { userId, token: rawToken, email };
}

/** A signed-in owner of a fresh organization. */
async function ownerOf(): Promise<{
  token: string;
  userId: string;
  slug: string;
  organizationId: string;
}> {
  const user = await signedIn();
  const slug = newSlug();
  const { organizationId } = await createOrganization(user.userId, {
    slug,
    name: "Acme",
  });
  return { token: user.token, userId: user.userId, slug, organizationId };
}

/** Adds a member and returns their user id. */
async function memberOf(
  organizationId: string,
  role: MembershipRole,
): Promise<{ userId: string; token: string; email: string }> {
  const user = await signedIn();
  await prisma.membership.create({
    data: { userId: user.userId, organizationId, role },
  });
  return { userId: user.userId, token: user.token, email: user.email };
}

test("O1: creating an organization returns 201 and makes the caller OWNER", async () => {
  const user = await signedIn();
  const slug = newSlug();

  const res = await createOrganizationHandler()(
    req("POST", { session: user.token, body: { slug, name: "Acme" } }),
  );

  expect(res.status).toBe(201);
  expect(bodyOf(res)["slug"]).toBe(slug);

  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId: user.userId },
  });
  expect(membership.role).toBe("OWNER");
});

test("O2: creating without a session is 401, not 404", async () => {
  // The one route where 401 is right. No organization is named, so there is
  // nothing whose existence a 401 could confirm — the enumeration argument
  // that shapes every scoped route does not apply here.
  const res = await createOrganizationHandler()(
    req("POST", { body: { slug: newSlug(), name: "Acme" } }),
  );

  expect(res.status).toBe(401);
});

test("O3: creating without a csrf pair is 403 and creates nothing", async () => {
  const user = await signedIn();

  const res = await createOrganizationHandler()({
    method: "POST",
    path: "/",
    headers: {},
    cookies: { [SESSION_COOKIE]: user.token },
    body: { slug: newSlug(), name: "Acme" },
  });

  expect(res.status).toBe(403);
  expect(await prisma.organization.count()).toBe(0);
});

test("O4: a reserved or malformed slug is 400, not 500", async () => {
  // A database CHECK violation is not an AuthError and would otherwise fall
  // through to the rethrow and become a 500. It is a 400: the caller sent
  // something invalid and can fix it.
  const user = await signedIn();

  for (const slug of ["members", "organizations", "api", "UP PER", "ab"]) {
    const res = await createOrganizationHandler()(
      req("POST", { session: user.token, body: { slug, name: "Acme" } }),
    );
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("INVALID_BODY");
  }

  expect(await prisma.organization.count()).toBe(0);
});

test("O5: a duplicate slug is 409", async () => {
  const owner = await ownerOf();
  const other = await signedIn();

  const res = await createOrganizationHandler()(
    req("POST", { session: other.token, body: { slug: owner.slug, name: "B" } }),
  );

  expect(res.status).toBe(409);
  expect(errorCode(res)).toBe("ORG_SLUG_TAKEN");
});

test("O6: a scoped route with no session is 404, not 401", async () => {
  // Deliberately different from O2. Here an organization IS named, and a 401
  // would confirm the slug is real to anyone who guessed it.
  const owner = await ownerOf();

  const handler = withOrgScope(owner.slug, grantMemberHandler());
  const res = await handler(req("POST", { body: { email: newEmail(), role: "VIEWER" } }));

  expect(res.status).toBe(404);
  expect(errorCode(res)).toBe("NOT_FOUND");
});

test("O7: a non-member and a non-existent organization answer identically", async () => {
  // The enumeration property. "You are not in it" and "it does not exist" must
  // be one answer.
  const owner = await ownerOf();
  const stranger = await signedIn();

  const notAMember = await withOrgScope(owner.slug, grantMemberHandler())(
    req("POST", {
      session: stranger.token,
      body: { email: newEmail(), role: "VIEWER" },
    }),
  );
  const noSuchOrg = await withOrgScope(newSlug(), grantMemberHandler())(
    req("POST", {
      session: stranger.token,
      body: { email: newEmail(), role: "VIEWER" },
    }),
  );

  expect(notAMember.status).toBe(404);
  expect(noSuchOrg.status).toBe(404);
  expect(notAMember.body).toEqual(noSuchOrg.body);
});

test("O8: granting a membership returns 201 and writes the row", async () => {
  const owner = await ownerOf();
  const target = await signedIn();

  const res = await withOrgScope(owner.slug, grantMemberHandler())(
    req("POST", {
      session: owner.token,
      body: { email: target.email, role: "BOOKKEEPER" },
    }),
  );

  expect(res.status).toBe(201);
  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId: target.userId, organizationId: owner.organizationId },
  });
  expect(membership.role).toBe("BOOKKEEPER");
});

test("O9: a role the caller may not grant is 403 and writes nothing", async () => {
  const owner = await ownerOf();
  const admin = await memberOf(owner.organizationId, "ADMIN");
  const target = await signedIn();

  const res = await withOrgScope(owner.slug, grantMemberHandler())(
    req("POST", {
      session: admin.token,
      body: { email: target.email, role: "ADMIN" },
    }),
  );

  expect(res.status).toBe(403);
  expect(errorCode(res)).toBe("AUTH_ROLE_ESCALATION");
  expect(
    await prisma.membership.count({ where: { userId: target.userId } }),
  ).toBe(0);
});

test("O10: OWNER is refused through the grant route, by an owner", async () => {
  const owner = await ownerOf();
  const target = await signedIn();

  const res = await withOrgScope(owner.slug, grantMemberHandler())(
    req("POST", {
      session: owner.token,
      body: { email: target.email, role: "OWNER" },
    }),
  );

  expect(res.status).toBe(403);
  expect(errorCode(res)).toBe("AUTH_OWNERSHIP_NOT_GRANTABLE");
});

test("O11: an invented role is 400, not a database error", async () => {
  // Passing the string straight through would let Prisma reject it, and the
  // failure would surface as a 500 — from which an attacker learns more than
  // from a refusal.
  const owner = await ownerOf();
  const target = await signedIn();

  for (const role of ["SUPERUSER", "owner", "", "ADMINISTRATOR"]) {
    const res = await withOrgScope(owner.slug, grantMemberHandler())(
      req("POST", { session: owner.token, body: { email: target.email, role } }),
    );
    expect(res.status).toBe(400);
  }
});

test("O12: granting to an unknown address is 404", async () => {
  const owner = await ownerOf();

  const res = await withOrgScope(owner.slug, grantMemberHandler())(
    req("POST", { session: owner.token, body: { email: newEmail(), role: "VIEWER" } }),
  );

  expect(res.status).toBe(404);
  expect(errorCode(res)).toBe("AUTH_USER_NOT_FOUND");
});

test("O13: granting twice is 409", async () => {
  const owner = await ownerOf();
  const target = await signedIn();
  const grant = withOrgScope(owner.slug, grantMemberHandler());

  await grant(
    req("POST", { session: owner.token, body: { email: target.email, role: "VIEWER" } }),
  );
  const second = await grant(
    req("POST", { session: owner.token, body: { email: target.email, role: "VIEWER" } }),
  );

  expect(second.status).toBe(409);
  expect(errorCode(second)).toBe("AUTH_ALREADY_MEMBER");
});

test("O14: changing a role is 204 and takes effect", async () => {
  const owner = await ownerOf();
  const member = await memberOf(owner.organizationId, "VIEWER");

  const res = await withOrgScope(owner.slug, changeRoleHandler(member.userId))(
    req("PATCH", { session: owner.token, body: { role: "ACCOUNTANT" } }),
  );

  expect(res.status).toBe(204);
  const updated = await prisma.membership.findFirstOrThrow({
    where: { userId: member.userId, organizationId: owner.organizationId },
  });
  expect(updated.role).toBe("ACCOUNTANT");
});

test("O15: the target user comes from the URL, never from the body", async () => {
  // `changeRoleHandler` takes the id as an argument from the route params. A
  // body field naming someone else must have no effect at all — otherwise a
  // caller could pass the checks for one target and act on another.
  const owner = await ownerOf();
  const victim = await memberOf(owner.organizationId, "ADMIN");
  const intended = await memberOf(owner.organizationId, "VIEWER");

  await withOrgScope(owner.slug, changeRoleHandler(intended.userId))(
    req("PATCH", {
      session: owner.token,
      body: { role: "BOOKKEEPER", userId: victim.userId, targetUserId: victim.userId },
    }),
  );

  const untouched = await prisma.membership.findFirstOrThrow({
    where: { userId: victim.userId, organizationId: owner.organizationId },
  });
  expect(untouched.role).toBe("ADMIN");

  const changed = await prisma.membership.findFirstOrThrow({
    where: { userId: intended.userId, organizationId: owner.organizationId },
  });
  expect(changed.role).toBe("BOOKKEEPER");
});

test("O16: an ADMIN cannot demote an OWNER through the route", async () => {
  const owner = await ownerOf();
  const admin = await memberOf(owner.organizationId, "ADMIN");

  const res = await withOrgScope(owner.slug, changeRoleHandler(owner.userId))(
    req("PATCH", { session: admin.token, body: { role: "VIEWER" } }),
  );

  expect(res.status).toBe(403);
  const still = await prisma.membership.findFirstOrThrow({
    where: { userId: owner.userId, organizationId: owner.organizationId },
  });
  expect(still.role).toBe("OWNER");
});

test("O17: removing a member is 204, and only an OWNER may do it", async () => {
  const owner = await ownerOf();
  const admin = await memberOf(owner.organizationId, "ADMIN");
  const victim = await memberOf(owner.organizationId, "VIEWER");

  const refused = await withOrgScope(owner.slug, removeMemberHandler(victim.userId))(
    req("DELETE", { session: admin.token }),
  );
  expect(refused.status).toBe(403);

  const allowed = await withOrgScope(owner.slug, removeMemberHandler(victim.userId))(
    req("DELETE", { session: owner.token }),
  );
  expect(allowed.status).toBe(204);
  expect(
    await prisma.membership.count({ where: { userId: victim.userId } }),
  ).toBe(0);
});

test("O18: transferring ownership is 204 and moves the role", async () => {
  const owner = await ownerOf();
  const successor = await memberOf(owner.organizationId, "ADMIN");

  const res = await withOrgScope(owner.slug, transferOwnershipHandler())(
    req("POST", { session: owner.token, body: { userId: successor.userId } }),
  );

  expect(res.status).toBe(204);
  const owners = await prisma.membership.findMany({
    where: { organizationId: owner.organizationId, role: "OWNER" },
  });
  expect(owners).toHaveLength(1);
  expect(owners[0]?.userId).toBe(successor.userId);
});

test("O19: every mutation requires a csrf pair", async () => {
  const owner = await ownerOf();
  const member = await memberOf(owner.organizationId, "VIEWER");

  const bare = (method: HttpMethod, body?: unknown): HttpRequest => ({
    method,
    path: "/",
    headers: {},
    cookies: { [SESSION_COOKIE]: owner.token },
    ...(body === undefined ? {} : { body }),
  });

  const responses = await Promise.all([
    withOrgScope(owner.slug, grantMemberHandler())(
      bare("POST", { email: member.email, role: "VIEWER" }),
    ),
    withOrgScope(owner.slug, changeRoleHandler(member.userId))(
      bare("PATCH", { role: "ADMIN" }),
    ),
    withOrgScope(owner.slug, removeMemberHandler(member.userId))(bare("DELETE")),
    withOrgScope(owner.slug, transferOwnershipHandler())(
      bare("POST", { userId: member.userId }),
    ),
  ]);

  for (const res of responses) {
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe("CSRF_INVALID");
  }

  // And none of them happened.
  const unchanged = await prisma.membership.findFirstOrThrow({
    where: { userId: member.userId, organizationId: owner.organizationId },
  });
  expect(unchanged.role).toBe("VIEWER");
});

test("O20: readString narrows rather than casting", async () => {
  expect(readString({ a: " x " }, "a")).toBe("x");
  expect(readString({ a: "   " }, "a")).toBeUndefined();
  expect(readString({ a: 1 }, "a")).toBeUndefined();
  expect(readString({ a: { $ne: null } }, "a")).toBeUndefined();
  expect(readString(null, "a")).toBeUndefined();
  expect(readString([], "a")).toBeUndefined();
  expect(readString("a string", "a")).toBeUndefined();
  // Own properties only: `"constructor" in {}` is true, but it is not ours.
  expect(readString({}, "constructor")).toBeUndefined();
  expect(readString({}, "toString")).toBeUndefined();
});

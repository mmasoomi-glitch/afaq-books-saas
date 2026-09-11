import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  SESSION_IDLE_TTL_MS,
  normaliseEmail,
  SessionExpiredError,
  SessionNotFoundError,
  hashSessionToken,
  registerUser,
  resolveScopeFromSession,
  resolveSession,
  signIn,
  signOut,
  signOutAllSessions,
} from "../../../src/server/auth/session";
import { NotAMemberError } from "../../../src/server/auth/errors";

const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

/** A registered, signed-in user. */
async function signedIn(): Promise<{
  email: string;
  userId: string;
  rawToken: string;
  expires: Date;
}> {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const { rawToken, userId, expires } = await signIn(email, PASSWORD);
  return { email, userId, rawToken, expires };
}

/** An organization the given user is a BOOKKEEPER of. */
async function orgFor(userId: string): Promise<{ id: string; slug: string }> {
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Test" },
  });
  await prisma.membership.create({
    data: { userId, organizationId: org.id, role: "BOOKKEEPER" },
  });
  return { id: org.id, slug: org.slug };
}

test("T1: register, sign in, resolve the session back to the same user", async () => {
  const { userId, rawToken } = await signedIn();
  expect((await resolveSession(rawToken)).userId).toBe(userId);
});

test("T2: the raw token is never stored — only its hash is", async () => {
  // This is the test that says a database disclosure does not hand an attacker
  // a set of live sessions.
  const { rawToken } = await signedIn();

  const rows = await prisma.session.findMany();
  expect(rows).toHaveLength(1);

  const stored = rows.map((r) => r.sessionToken);
  expect(stored).not.toContain(rawToken);
  expect(stored).toContain(hashSessionToken(rawToken));
});

test("T3: a wrong password is refused", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  await expect(signIn(email, "not the password")).rejects.toBeInstanceOf(
    InvalidCredentialsError,
  );
});

test("T4: an unknown email is indistinguishable from a wrong password", async () => {
  const known = newEmail();
  await registerUser(known, PASSWORD);

  const wrongPassword = await signIn(known, "not the password").catch(
    (e: unknown) => e,
  );
  const unknownEmail = await signIn(newEmail(), "not the password").catch(
    (e: unknown) => e,
  );

  expect(wrongPassword).toBeInstanceOf(InvalidCredentialsError);
  expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);

  // Same class is not enough — the message must match too, or the response
  // body tells an attacker which addresses are registered.
  const a = wrongPassword instanceof Error ? wrongPassword.message : "a";
  const b = unknownEmail instanceof Error ? unknownEmail.message : "b";
  expect(a).toBe(b);
});

test("T5: a token that was never issued is not found", async () => {
  await expect(resolveSession(randomUUID())).rejects.toBeInstanceOf(
    SessionNotFoundError,
  );
});

test("T6: an expired session is refused and deleted on sight", async () => {
  const { userId, rawToken } = await signedIn();

  await prisma.session.update({
    where: { sessionToken: hashSessionToken(rawToken) },
    data: { expires: new Date("2020-01-01T00:00:00.000Z") },
  });

  await expect(resolveSession(rawToken)).rejects.toBeInstanceOf(
    SessionExpiredError,
  );
  expect(await prisma.session.count({ where: { userId } })).toBe(0);
});

test("T7: signing out ends the session", async () => {
  const { rawToken } = await signedIn();
  await signOut(rawToken);

  await expect(resolveSession(rawToken)).rejects.toBeInstanceOf(
    SessionNotFoundError,
  );
});

test("T8: signing out is idempotent", async () => {
  const { rawToken } = await signedIn();

  await expect(signOut(rawToken)).resolves.toBeUndefined();
  await expect(signOut(rawToken)).resolves.toBeUndefined();
  await expect(signOut(randomUUID())).resolves.toBeUndefined();
});

test("T9: signOutAllSessions ends every session for that user", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  await signIn(email, PASSWORD);
  await signIn(email, PASSWORD);
  const { userId } = await signIn(email, PASSWORD);

  expect(await signOutAllSessions(userId)).toBe(3);
  expect(await prisma.session.count({ where: { userId } })).toBe(0);
});

test("T10: an email can only be registered once", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);

  await expect(registerUser(email, PASSWORD)).rejects.toBeInstanceOf(
    EmailAlreadyRegisteredError,
  );
});

test("T11: a session plus a membership resolves to a scope", async () => {
  const { userId, rawToken } = await signedIn();
  const org = await orgFor(userId);

  const scope = await resolveScopeFromSession(rawToken, org.slug);
  expect(scope.userId).toBe(userId);
  expect(scope.organizationId).toBe(org.id);
  expect(scope.organizationSlug).toBe(org.slug);
  expect(scope.role).toBe("BOOKKEEPER");
});

test("T12: authenticating is not the same as being allowed in", async () => {
  // A valid session against an organization the user is not a member of.
  const { rawToken } = await signedIn();
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Someone else's" },
  });

  await expect(
    resolveScopeFromSession(rawToken, org.slug),
  ).rejects.toBeInstanceOf(NotAMemberError);
});

test("T13: revoking a membership takes effect on the next request", async () => {
  // The property that matters. Authorization is re-resolved per request rather
  // than baked into the session, so access ends when it is revoked — not
  // whenever the token happens to expire.
  const { userId, rawToken } = await signedIn();
  const org = await orgFor(userId);

  expect((await resolveScopeFromSession(rawToken, org.slug)).role).toBe(
    "BOOKKEEPER",
  );

  await prisma.membership.deleteMany({
    where: { userId, organizationId: org.id },
  });

  // Same token, still well within its idle window.
  await expect(
    resolveScopeFromSession(rawToken, org.slug),
  ).rejects.toBeInstanceOf(NotAMemberError);
});

test("T14: a session expires roughly SESSION_IDLE_TTL_MS from now", async () => {
  // The IDLE clock, not the absolute one. A fresh session is good for a day of
  // inactivity; sliding renewal is what carries an active user past that, up to
  // the absolute ceiling. See S1-S6 in http/session-renewal.test.ts.
  const { expires } = await signedIn();
  const remaining = expires.getTime() - Date.now();

  expect(remaining).toBeGreaterThan(SESSION_IDLE_TTL_MS - 60_000);
  expect(remaining).toBeLessThanOrEqual(SESSION_IDLE_TTL_MS);
});

test("T15: an address registered in mixed case signs in in any case", async () => {
  // Found by independent review, not by this suite, which is the point of
  // having one. `enforce` lowercased the address to build its rate-limit key
  // while the user lookup used the string as typed, so registering as
  // `User@x.com` and signing in as `user@x.com` was "invalid email or
  // password" — a login failure with no visible cause.
  const local = randomUUID();
  const mixed = `User.${local}@Example.Test`;
  await registerUser(mixed, PASSWORD);

  await expect(signIn(mixed.toLowerCase(), PASSWORD)).resolves.toBeDefined();
  await expect(signIn(mixed.toUpperCase(), PASSWORD)).resolves.toBeDefined();
  await expect(signIn(`  ${mixed}  `, PASSWORD)).resolves.toBeDefined();
});

test("T16: a case variant of a taken address cannot be registered", async () => {
  // The more serious half. `users.email` is unique on the RAW string, so
  // before normalisation moved into this layer, `Admin@corp.com` and
  // `admin@corp.com` were two separate accounts — anyone could claim a case
  // variant of a colleague's address and receive mail meant for them.
  const local = randomUUID();
  await registerUser(`admin.${local}@corp.test`, PASSWORD);

  await expect(
    registerUser(`Admin.${local}@Corp.Test`, PASSWORD),
  ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

  expect(await prisma.user.count()).toBe(1);
});

test("T17: the stored address is the normalised one", async () => {
  const local = randomUUID();
  const mixed = `  Mixed.${local}@Example.TEST `;
  const { userId } = await registerUser(mixed, PASSWORD);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  expect(user.email).toBe(normaliseEmail(mixed));
  expect(user.email).toBe(`mixed.${local}@example.test`);
});

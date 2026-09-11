import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup.js";
import { prisma } from "../../../src/server/db/client.js";
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_RENEW_AFTER_MS,
  SessionExpiredError,
  SessionNotFoundError,
  hashSessionToken,
  registerUser,
  resolveSession,
  signIn,
  touchSession,
} from "../../../src/server/auth/session.js";

/**
 * Sliding renewal, and the ceiling that stops it sliding forever.
 *
 * Time is moved by rewriting `created_at` and `expires` rather than by faking
 * the clock, because the behaviour under test is a comparison the DATABASE rows
 * participate in. A fake timer would prove the arithmetic and not the storage.
 */

const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

async function freshSession(): Promise<{ rawToken: string; userId: string }> {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  const { rawToken, userId } = await signIn(email, PASSWORD);
  return { rawToken, userId };
}

/** Rewrite a session's timestamps as if it had been created `agoMs` ago. */
async function backdate(
  rawToken: string,
  agoMs: number,
  expiresInMs: number,
): Promise<void> {
  const now = Date.now();
  await prisma.session.update({
    where: { sessionToken: hashSessionToken(rawToken) },
    data: {
      createdAt: new Date(now - agoMs),
      expires: new Date(now + expiresInMs),
    },
  });
}

async function storedExpiry(rawToken: string): Promise<Date> {
  const row = await prisma.session.findUniqueOrThrow({
    where: { sessionToken: hashSessionToken(rawToken) },
  });
  return row.expires;
}

test("S1: a session just created is not written again on use", async () => {
  // Renewing on every request would turn every authenticated read into a write
  // and make one session row the contention point for a busy organization.
  const { rawToken } = await freshSession();
  const before = await storedExpiry(rawToken);

  const returned = await touchSession(rawToken);

  expect(returned.getTime()).toBe(before.getTime());
  expect((await storedExpiry(rawToken)).getTime()).toBe(before.getTime());
});

test("S2: an expiry that has drifted past the threshold is slid forward", async () => {
  const { rawToken } = await freshSession();
  // Two hours of use have passed: the stored expiry is two hours short of what
  // a fresh idle window would give, which is past the one-hour threshold.
  await backdate(rawToken, 2 * 60 * 60_000, SESSION_IDLE_TTL_MS - 2 * 60 * 60_000);
  const before = await storedExpiry(rawToken);

  const returned = await touchSession(rawToken);

  expect(returned.getTime()).toBeGreaterThan(before.getTime());
  const expected = Date.now() + SESSION_IDLE_TTL_MS;
  expect(Math.abs(returned.getTime() - expected)).toBeLessThan(60_000);
  // Persisted, not merely returned.
  expect((await storedExpiry(rawToken)).getTime()).toBe(returned.getTime());
});

test("S3: renewal is capped at the absolute ceiling and never crosses it", async () => {
  // Thirteen days old. A full idle window from now would land past the
  // fourteen-day ceiling, so renewal must clamp rather than extend.
  const thirteenDays = 13 * 24 * 60 * 60_000;
  const { rawToken } = await freshSession();
  await backdate(rawToken, thirteenDays, 60 * 60_000);

  const row = await prisma.session.findUniqueOrThrow({
    where: { sessionToken: hashSessionToken(rawToken) },
  });
  const ceiling = row.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;

  const returned = await touchSession(rawToken);

  expect(returned.getTime()).toBeLessThanOrEqual(ceiling);
  expect(returned.getTime()).toBe(ceiling);
});

test("S4: a session past the ceiling is refused even with a future expiry", async () => {
  // This is the case the ceiling exists for. `expires` says the session is
  // good for another hour, because renewal kept moving it — but it was created
  // more than fourteen days ago, so a stolen token that has been kept warm
  // stops working here.
  const { rawToken } = await freshSession();
  await backdate(rawToken, SESSION_ABSOLUTE_TTL_MS + 60_000, 60 * 60_000);

  await expect(resolveSession(rawToken)).rejects.toBeInstanceOf(
    SessionExpiredError,
  );
  await expect(touchSession(rawToken)).rejects.toBeInstanceOf(
    SessionNotFoundError,
  );
});

test("S5: a session past its idle window is refused and the row is removed", async () => {
  const { rawToken } = await freshSession();
  await backdate(rawToken, 60_000, -1000);

  await expect(resolveSession(rawToken)).rejects.toBeInstanceOf(
    SessionExpiredError,
  );
  expect(await prisma.session.count()).toBe(0);
});

test("S6: touching an unknown token is not found, not expired", async () => {
  await expect(touchSession("never issued")).rejects.toBeInstanceOf(
    SessionNotFoundError,
  );
});

test("S7: the two clocks are configured as intended", async () => {
  // Pinned so that a change to either is a deliberate edit to this line rather
  // than a number quietly drifting. The idle window is the short one; the
  // ceiling is what renewal may not cross; the threshold only controls how
  // often we write.
  expect(SESSION_IDLE_TTL_MS).toBe(24 * 60 * 60_000);
  expect(SESSION_ABSOLUTE_TTL_MS).toBe(14 * 24 * 60 * 60_000);
  expect(SESSION_RENEW_AFTER_MS).toBe(60 * 60_000);
  expect(SESSION_IDLE_TTL_MS).toBeLessThan(SESSION_ABSOLUTE_TTL_MS);
});

test("S8: repeated use keeps an active session alive past its idle window", async () => {
  // The property the whole mechanism exists for: someone working continuously
  // is never signed out by the idle clock, because each use pushes it forward.
  const { rawToken } = await freshSession();

  for (let day = 1; day <= 5; day += 1) {
    // Simulate a day's gap, arriving with hours to spare.
    await backdate(rawToken, day * 24 * 60 * 60_000, 2 * 60 * 60_000);
    await touchSession(rawToken);
    await expect(resolveSession(rawToken)).resolves.toBeDefined();
  }

  expect(await prisma.session.count()).toBe(1);
});

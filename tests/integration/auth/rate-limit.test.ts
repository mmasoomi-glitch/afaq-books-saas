import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup.js";
import { prisma } from "../../../src/server/db/client.js";
import {
  MAX_DELAY_MS,
  POLICIES,
  RateLimitedError,
  checkAndConsume,
  delayForAttempt,
  enforce,
  reapExpired,
  recordSecurityEvent,
} from "../../../src/server/auth/rate-limit.js";
import {
  InvalidCredentialsError,
  registerUser,
  signIn,
} from "../../../src/server/auth/session.js";

const PASSWORD = "correct horse battery staple";
const SIGNIN = POLICIES.signin;

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

/** Consume `times` attempts against one counter and return the last result. */
async function consume(
  dimension: "ip" | "account",
  value: string,
  times: number,
) {
  let last = await checkAndConsume("signin", dimension, value);
  for (let i = 1; i < times; i += 1) {
    last = await checkAndConsume("signin", dimension, value);
  }
  return last;
}

test("L1: the backoff curve is 1s, 2s, 4s, 8s, capped at 10s", () => {
  expect(delayForAttempt(0)).toBe(0);
  expect(delayForAttempt(-1)).toBe(0);
  expect(delayForAttempt(1)).toBe(1000);
  expect(delayForAttempt(2)).toBe(2000);
  expect(delayForAttempt(3)).toBe(4000);
  expect(delayForAttempt(4)).toBe(8000);
  expect(delayForAttempt(5)).toBe(MAX_DELAY_MS);
  expect(delayForAttempt(9)).toBe(MAX_DELAY_MS);
});

test("L2: the first attempt is allowed", async () => {
  const result = await checkAndConsume("signin", "ip", randomUUID());
  expect(result.allowed).toBe(true);
  expect(result.remaining).toBe(SIGNIN.limit - 1);
});

test("L3: attempts up to the limit are all allowed", async () => {
  const value = randomUUID();
  for (let i = 1; i <= SIGNIN.limit; i += 1) {
    const result = await checkAndConsume("signin", "ip", value);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(SIGNIN.limit - i);
  }
});

test("L4: the attempt past the limit is refused and costs a second", async () => {
  const value = randomUUID();
  await consume("ip", value, SIGNIN.limit);

  const over = await checkAndConsume("signin", "ip", value);
  expect(over.allowed).toBe(false);
  expect(over.delayMs).toBe(1000);
  expect(over.remaining).toBe(0);
});

test("L5: each further attempt costs progressively more", async () => {
  const value = randomUUID();
  await consume("ip", value, SIGNIN.limit);

  expect((await checkAndConsume("signin", "ip", value)).delayMs).toBe(1000);
  expect((await checkAndConsume("signin", "ip", value)).delayMs).toBe(2000);
  expect((await checkAndConsume("signin", "ip", value)).delayMs).toBe(4000);
});

test("L6: exhausting one account does not affect another", async () => {
  const a = randomUUID();
  const b = randomUUID();
  await consume("account", a, SIGNIN.limit + 1);

  expect((await checkAndConsume("signin", "account", b)).allowed).toBe(true);
});

test("L7: the two dimensions are independent counters", async () => {
  // The same literal value in both dimensions must not share a counter, or an
  // address would be throttled by an unrelated account that happens to match.
  const value = randomUUID();
  await consume("ip", value, SIGNIN.limit + 1);

  expect((await checkAndConsume("signin", "account", value)).allowed).toBe(true);
});

test("L8: enforce with nothing to key on is a no-op", async () => {
  await expect(
    enforce("signin", undefined, undefined),
  ).resolves.toBeUndefined();
});

test("L9: enforce refuses once a counter is exhausted", async () => {
  const ip = randomUUID();
  await consume("ip", ip, SIGNIN.limit + 1);

  const error = await enforce("signin", ip, undefined).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RateLimitedError);
  if (error instanceof RateLimitedError) {
    expect(error.code).toBe("AUTH_RATE_LIMITED");
    expect(error.retryAfterMs).toBeGreaterThan(0);
  }
});

test("L10: enforce consumes BOTH counters even when the first is blocked", async () => {
  // If it short-circuited, the account counter would stay undercounted and an
  // attacker could grind one account from many addresses for free.
  const ip = randomUUID();
  const account = randomUUID();
  await consume("ip", ip, SIGNIN.limit + 1);

  await enforce("signin", ip, account).catch(() => undefined);

  const row = await prisma.rateLimit.findUnique({
    where: { key: `signin:account:${account}` },
  });
  expect(row).not.toBeNull();
  expect(row?.count).toBe(1);
});

test("L11: reaping removes expired counters and leaves live ones", async () => {
  const now = new Date();
  await prisma.rateLimit.create({
    data: {
      key: `stale-${randomUUID()}`,
      count: 1,
      windowStart: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() - 1_000),
    },
  });
  const liveKey = `live-${randomUUID()}`;
  await prisma.rateLimit.create({
    data: {
      key: liveKey,
      count: 1,
      windowStart: now,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });

  expect(await reapExpired(now)).toBe(1);
  expect(
    await prisma.rateLimit.findUnique({ where: { key: liveKey } }),
  ).not.toBeNull();
});

test("L12: a security event round-trips every field", async () => {
  const email = newEmail();
  await recordSecurityEvent("test.event", {
    ip: "192.0.2.7",
    email,
    detail: "a detail",
  });

  const row = await prisma.securityEvent.findFirstOrThrow({
    where: { eventType: "test.event" },
  });
  expect(row.ip).toBe("192.0.2.7");
  expect(row.email).toBe(email);
  expect(row.detail).toBe("a detail");
});

test("L13: omitted fields are stored as null, not as the string undefined", async () => {
  await recordSecurityEvent("test.bare", {});

  const row = await prisma.securityEvent.findFirstOrThrow({
    where: { eventType: "test.bare" },
  });
  expect(row.ip).toBeNull();
  expect(row.email).toBeNull();
  expect(row.detail).toBeNull();
});

test("L14: a failed sign-in is recorded", async () => {
  const email = newEmail();
  await signIn(email, PASSWORD).catch(() => undefined);

  const row = await prisma.securityEvent.findFirstOrThrow({
    where: { eventType: "auth.signin.failed", email },
  });
  expect(row.detail).toBe("no such user");
});

test("L15: a successful sign-in is recorded", async () => {
  const email = newEmail();
  await registerUser(email, PASSWORD);
  await signIn(email, PASSWORD);

  await expect(
    prisma.securityEvent.findFirstOrThrow({
      where: { eventType: "auth.signin.succeeded", email },
    }),
  ).resolves.toBeDefined();
});

test("L16: the sixth bad password is rate limited, not merely refused", async () => {
  // The whole point of the blocker this closes. Five wrong passwords are a
  // user having a bad day; the sixth is someone guessing, and it costs them.
  //
  // enforce() no longer sleeps before throwing, so this test is fast now: the
  // penalty is reported as retryAfterMs for the caller to surface as a 429.
  const email = newEmail();
  await registerUser(email, PASSWORD);

  for (let i = 0; i < SIGNIN.limit; i += 1) {
    const e = await signIn(email, "wrong password").catch((err: unknown) => err);
    expect(e).toBeInstanceOf(InvalidCredentialsError);
  }

  const blocked = await signIn(email, "wrong password").catch(
    (err: unknown) => err,
  );
  expect(blocked).toBeInstanceOf(RateLimitedError);
  if (blocked instanceof RateLimitedError) {
    expect(blocked.retryAfterMs).toBe(1000);
  }
});

test("L17: enforce returns promptly rather than holding the caller", async () => {
  // The delay is advisory, carried on the error, not spent by the server. If
  // enforce slept, a flood of blocked attempts would occupy tasks instead of
  // being shed - the throttle would become the load.
  const ip = randomUUID();
  await consume("ip", ip, SIGNIN.limit + 4); // deep into the backoff curve

  const startedAt = Date.now();
  const error = await enforce("signin", ip, undefined).catch((e: unknown) => e);
  const elapsed = Date.now() - startedAt;

  expect(error).toBeInstanceOf(RateLimitedError);
  if (error instanceof RateLimitedError) {
    // A real penalty is reported...
    expect(error.retryAfterMs).toBeGreaterThanOrEqual(8000);
  }
  // ...but the server did not wait it out.
  expect(elapsed).toBeLessThan(1000);
});

import { prisma } from "../db/client";

/**
 * Rate limiting for the authentication endpoints.
 *
 * The defence has two layers and neither replaces the other. argon2id makes
 * each individual guess expensive — roughly 19 MiB and tens of milliseconds.
 * This makes the guesses slow and bounded in number. An attacker who only has
 * to pay the argon2 cost can still grind an account given time; an attacker
 * who is only rate limited can still parallelise cheaply. Both together is what
 * makes online guessing impractical.
 *
 * Strategy decided by independent review: Postgres-backed fixed window, limited
 * on both source address and account, progressive delay rather than lockout,
 * failing open.
 */

export type RateLimitAction = "signin" | "signup" | "password-reset";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

/**
 * The sign-in headline is "5 attempts per 5 minutes", but the window here is
 * 15 minutes: the window is what the counter RESETS on, so a longer window
 * means a burst of failures keeps costing the attacker for longer rather than
 * clearing every five minutes.
 */
export const POLICIES: Readonly<Record<RateLimitAction, RateLimitPolicy>> =
  Object.freeze({
    signin: { limit: 5, windowMs: 15 * 60_000 },
    signup: { limit: 3, windowMs: 60 * 60_000 },
    "password-reset": { limit: 3, windowMs: 60 * 60_000 },
  });

export const MAX_DELAY_MS = 10_000;

/**
 * 1 over the limit costs 1s, then 2s, 4s, 8s, capped at 10s.
 *
 * A progressive delay rather than a hard lockout, deliberately. Locking an
 * account after N failures hands anyone who knows an email address the ability
 * to lock its owner out of their own accounting system — the countermeasure
 * becomes the attack.
 */
export function delayForAttempt(attemptsOverLimit: number): number {
  if (attemptsOverLimit <= 0) return 0;
  return Math.min(1000 * 2 ** (attemptsOverLimit - 1), MAX_DELAY_MS);
}

export interface RateLimitResult {
  allowed: boolean;
  delayMs: number;
  remaining: number;
}

export class RateLimitedError extends Error {
  readonly code = "AUTH_RATE_LIMITED";
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`too many attempts; retry after ${retryAfterMs}ms`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Consume one attempt against a counter and report whether it is allowed.
 *
 * The whole read-modify-write is ONE atomic statement. A read followed by an
 * update would let two concurrent attempts both observe count=4 and both store
 * 5, so an attacker could exceed the limit simply by firing requests in
 * parallel — which is exactly what an attacker does. `ON CONFLICT DO UPDATE`
 * takes a row lock, so concurrent callers serialise on it.
 *
 * The CASE expressions roll the window over in the same statement: if the
 * stored window started before the cutoff, the counter restarts at 1.
 */
export async function checkAndConsume(
  action: RateLimitAction,
  dimension: "ip" | "account",
  value: string,
): Promise<RateLimitResult> {
  const policy = POLICIES[action];
  const key = `${action}:${dimension}:${value}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - policy.windowMs);
  const expires = new Date(now.getTime() + policy.windowMs);

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO rate_limits (id, key, count, window_start, expires_at)
      VALUES (gen_random_uuid(), ${key}, 1, ${now}, ${expires})
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
                  WHEN rate_limits.window_start < ${cutoff} THEN 1
                  ELSE rate_limits.count + 1
                END,
        window_start = CASE
                  WHEN rate_limits.window_start < ${cutoff} THEN ${now}
                  ELSE rate_limits.window_start
                END,
        expires_at = CASE
                  WHEN rate_limits.window_start < ${cutoff} THEN ${expires}
                  ELSE rate_limits.expires_at
                END
      RETURNING count`;

    const row = rows[0];
    if (row === undefined) {
      throw new Error("rate limit upsert returned no row");
    }

    const count = row.count;
    if (count <= policy.limit) {
      return { allowed: true, delayMs: 0, remaining: policy.limit - count };
    }
    return {
      allowed: false,
      delayMs: delayForAttempt(count - policy.limit),
      remaining: 0,
    };
  } catch (error) {
    // Fails OPEN on purpose. A database problem must not lock every user out of
    // their own books — in an accounting system, availability of the ledger is
    // itself a safety property.
    //
    // The trade-off, stated plainly: an attacker who can induce database errors
    // also disables this limiter. That is why it is one layer and not the only
    // one, and why the failure is logged loudly rather than swallowed.
    console.warn(`[rate-limit] store unavailable for ${key}; failing open`, error);
    return { allowed: true, delayMs: 0, remaining: 0 };
  }
}

/**
 * Enforce both dimensions for an action.
 *
 * Both counters are always consumed — no short-circuit on the first block —
 * because they defend against different attacks. One address spraying many
 * accounts trips the address counter; many addresses grinding one account trips
 * the account counter. Skipping the second check would leave one of those
 * counters undercounted and exploitable.
 *
 * The penalty is REPORTED, not spent. See the comment at the throw.
 */
export async function enforce(
  action: RateLimitAction,
  ip: string | undefined,
  account: string | undefined,
): Promise<void> {
  const results: RateLimitResult[] = [];
  if (ip !== undefined) {
    results.push(await checkAndConsume(action, "ip", ip));
  }
  if (account !== undefined) {
    results.push(await checkAndConsume(action, "account", account));
  }

  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length === 0) return;

  // The LARGER of the two delays, not the first one found: if an address is 1
  // over but the account is 5 over, the account's penalty is the real one.
  const delayMs = Math.max(...blocked.map((r) => r.delayMs));

  // Throws IMMEDIATELY rather than sleeping first.
  //
  // An earlier version awaited the delay server-side, reasoning that a hostile
  // client would otherwise just ignore it. That reasoning was right about the
  // client and wrong about the cost: holding a task open for up to ten seconds
  // per blocked attempt turns the throttle itself into a resource-exhaustion
  // vector, and a flood of blocked attackers would occupy the server rather
  // than being shed by it.
  //
  // So the wait is now advisory — surfaced as HTTP 429 with Retry-After — and
  // the deterrent lives in the counter instead. A client that ignores
  // Retry-After and retries immediately still advances the window and keeps
  // climbing the backoff curve, so ignoring it buys the attacker nothing while
  // costing us nothing. Decided by independent review; see B-20260911-07.
  throw new RateLimitedError(delayMs);
}

/**
 * Security events live in their own table rather than `audit_logs`, because
 * `audit_logs.organization_id` and `actor_id` are both NOT NULL and a failed
 * sign-in usually has neither — there may be no such user, and certainly no
 * resolved organization.
 *
 * Failing to record an event must not break sign-in, but it must be loud.
 */
export async function recordSecurityEvent(
  eventType: string,
  fields: { ip?: string; email?: string; detail?: string },
): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        eventType,
        ...(fields.ip === undefined ? {} : { ip: fields.ip }),
        ...(fields.email === undefined ? {} : { email: fields.email }),
        ...(fields.detail === undefined ? {} : { detail: fields.detail }),
      },
    });
  } catch (error) {
    console.warn(`[security-event] failed to record ${eventType}`, error);
  }
}

/** For a scheduled job. Returns how many expired counters were removed. */
export async function reapExpired(now?: Date): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: now ?? new Date() } },
  });
  return count;
}

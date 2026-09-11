import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db/client";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { AuthError } from "./errors";
import { enforce, recordSecurityEvent } from "./rate-limit";
import type { OrgScope } from "./scope";
import { resolveOrgScope } from "./scope";

/**
 * The session layer, deliberately independent of any web framework.
 *
 * Auth.js v5 can adopt this later by delegating to these functions. Keeping the
 * logic here means the security properties — that a token is never stored in
 * the clear, that a revoked membership takes effect on the next request, that
 * an unknown email is indistinguishable from a wrong password — are testable
 * without booting an HTTP server.
 */

/**
 * The SAME error, with the SAME message, for an unknown email and for a wrong
 * password. Telling them apart turns the sign-in form into an oracle for which
 * addresses are registered.
 */
export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("invalid email or password", "AUTH_INVALID_CREDENTIALS");
  }
}

export class SessionExpiredError extends AuthError {
  constructor() {
    super("session expired", "AUTH_SESSION_EXPIRED");
  }
}

export class SessionNotFoundError extends AuthError {
  constructor() {
    super("session not found", "AUTH_SESSION_NOT_FOUND");
  }
}

/**
 * Registration deliberately does NOT get the same treatment as sign-in: it has
 * to tell the user their email is taken, or they cannot proceed. The asymmetry
 * is intentional. A public sign-up form must therefore rate-limit and should
 * use email confirmation, or registration becomes the enumeration oracle that
 * sign-in refuses to be.
 */
export class EmailAlreadyRegisteredError extends AuthError {
  constructor() {
    super("that email is already registered", "AUTH_EMAIL_TAKEN");
  }
}

/**
 * Two clocks, not one, and they answer different questions.
 *
 * `SESSION_IDLE_TTL_MS` is how long a session survives WITHOUT being used. It
 * slides forward every time the session is presented, so an active user never
 * meets it. A day is short for a web app and ordinary for financial software:
 * a laptop left open in an office overnight should not still be signed into
 * someone's books in the morning.
 *
 * `SESSION_ABSOLUTE_TTL_MS` is the ceiling from creation that renewal may never
 * cross. Without it, sliding renewal means a stolen token is valid forever
 * provided the thief keeps using it — the renewal would work just as well for
 * them as for the real user. This is the clock that eventually stops them.
 *
 * Previously there was one fixed 14-day expiry set at sign-in. That is now the
 * absolute ceiling, and the idle timeout is the new, tighter bound. Sliding
 * renewal decided by independent review; see B-20260911-10.
 */
export const SESSION_IDLE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
export const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * How stale `expires` must be before renewal bothers writing.
 *
 * Renewing on every request would turn every authenticated read into a write,
 * and a busy organization's reporting page would contend on one session row.
 * The user-visible effect of the threshold is nil: the session is extended a
 * full idle-window ahead, so lagging by up to an hour changes nothing anyone
 * can observe.
 */
export const SESSION_RENEW_AFTER_MS = 1000 * 60 * 60; // 1 hour

/**
 * Only the hash of a session token is stored. The raw token is what the client
 * holds, so a database disclosure does not hand an attacker a set of live
 * sessions.
 *
 * sha256 rather than argon2 on purpose: the token is 256 bits of CSPRNG output,
 * so there is nothing to stretch — it is not guessable by search — and this
 * runs on every authenticated request where latency matters.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Email addresses are normalised HERE, in the layer that persists and reads
 * them, not only at the HTTP edge.
 *
 * This was a real defect, found by independent review. `enforce` already
 * lowercased the address to build its rate-limit key, but the user lookup and
 * the insert used the string as given. Two consequences, both bad:
 *
 *  - `users.email` is unique on the RAW string, so `Admin@corp.com` and
 *    `admin@corp.com` were two different accounts. Anyone could register a
 *    case variant of an existing colleague's address.
 *  - Registering as `User@x.com` and signing in as `user@x.com` failed with
 *    "invalid email or password", because the lookup was case-sensitive while
 *    the user reasonably assumed it was not.
 *
 * The HTTP handler normalises too. That is not redundancy worth removing: it
 * keeps the rate-limit key and the lookup in agreement for every caller,
 * including tests and any future service path that never touches HTTP.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SignInResult {
  rawToken: string;
  userId: string;
  expires: Date;
}

export interface AuthRequestContext {
  /** Source address, when the caller knows one. Undefined off the HTTP path. */
  ip?: string;
}

export async function signIn(
  email: string,
  password: string,
  context: AuthRequestContext = {},
): Promise<SignInResult> {
  const address = normaliseEmail(email);

  // Rate limiting runs BEFORE the credential check, so a blocked attempt never
  // reaches argon2 and never touches the user table. Both the source address
  // and the account are counted; see rate-limit.ts for why both.
  await enforce("signin", context.ip, address);

  const user = await prisma.user.findUnique({ where: { email: address } });

  if (user === null || user.passwordHash === null) {
    // Spend comparable time before failing, so the response does not reveal
    // whether the address exists. A user row with no passwordHash is an
    // OAuth-only account and is treated identically.
    await verifyAgainstDummy(password);
    await recordSecurityEvent("auth.signin.failed", {
      ...(context.ip === undefined ? {} : { ip: context.ip }),
      email: address,
      detail: "no such user",
    });
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordSecurityEvent("auth.signin.failed", {
      ...(context.ip === undefined ? {} : { ip: context.ip }),
      email: address,
      detail: "bad password",
    });
    throw new InvalidCredentialsError();
  }

  const rawToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_IDLE_TTL_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: hashSessionToken(rawToken),
      expires,
    },
  });

  await recordSecurityEvent("auth.signin.succeeded", {
    ...(context.ip === undefined ? {} : { ip: context.ip }),
    email: address,
  });

  return { rawToken, userId: user.id, expires };
}

export async function resolveSession(
  rawToken: string,
): Promise<{ userId: string; expires: Date }> {
  const session = await prisma.session.findUnique({
    where: { sessionToken: hashSessionToken(rawToken) },
  });

  if (session === null) {
    throw new SessionNotFoundError();
  }

  const now = Date.now();

  // Two ways to be dead, and both are checked. The idle clock is `expires`; the
  // absolute clock is creation plus the ceiling. A session that has been kept
  // alive by renewal for a fortnight fails the second test while passing the
  // first, which is the entire point of having the second one.
  const absoluteDeadline =
    session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;

  if (session.expires.getTime() <= now || absoluteDeadline <= now) {
    // Removed on sight rather than left to accumulate. A sweeper job can still
    // exist later for sessions nobody ever presents again.
    await prisma.session.delete({ where: { id: session.id } });
    throw new SessionExpiredError();
  }

  return { userId: session.userId, expires: session.expires };
}

/**
 * Slide a live session forward. Returns the expiry the caller should reflect
 * in the cookie — the existing one when no write was needed.
 *
 * This is separate from `resolveSession` on purpose. Resolution is a read that
 * must work identically everywhere, including in tests that assert expiry
 * behaviour; renewal is a write with a policy attached. Folding the write into
 * the read would mean no caller could ever check a session without also
 * extending it, and the absolute-ceiling test below could not be written at
 * all.
 *
 * The renewal is CAPPED at the absolute deadline rather than refused near it.
 * Refusing would sign an active user out an idle-window early; capping lets
 * them work right up to the ceiling and then stop, which is what the ceiling
 * is supposed to mean.
 */
export async function touchSession(rawToken: string): Promise<Date> {
  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { sessionToken: tokenHash },
  });

  if (session === null) throw new SessionNotFoundError();

  const now = Date.now();
  const absoluteDeadline =
    session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;

  if (session.expires.getTime() <= now || absoluteDeadline <= now) {
    await prisma.session.delete({ where: { id: session.id } });
    throw new SessionExpiredError();
  }

  const target = Math.min(now + SESSION_IDLE_TTL_MS, absoluteDeadline);

  // Only write when the gain is material. `target` can also be BELOW the stored
  // expiry once the ceiling binds, and moving expiry backwards here would
  // shorten a session for no reason, so the comparison is one-directional.
  if (target - session.expires.getTime() < SESSION_RENEW_AFTER_MS) {
    return session.expires;
  }

  const expires = new Date(target);
  await prisma.session.update({
    where: { sessionToken: tokenHash },
    data: { expires },
  });
  return expires;
}

/**
 * The seam between a session and the ledger's authorization gate.
 *
 * Membership is re-resolved here on EVERY call, not cached into the session.
 * That is what makes revoking a membership take effect on the user's next
 * request rather than whenever their session happens to expire.
 */
export async function resolveScopeFromSession(
  rawToken: string,
  organizationSlug: string,
): Promise<OrgScope> {
  const { userId } = await resolveSession(rawToken);
  return resolveOrgScope(userId, organizationSlug);
}

/** Idempotent: signing out a token that does not exist is not an error. */
export async function signOut(rawToken: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { sessionToken: hashSessionToken(rawToken) },
  });
}

/** What a password change or a suspected compromise calls. Returns the count. */
export async function signOutAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

/**
 * Creates a user with NO membership. Until someone grants one, this account can
 * authenticate but cannot reach any organization's data at all — resolveOrgScope
 * will refuse.
 */
export async function registerUser(
  email: string,
  password: string,
  name?: string,
  context: AuthRequestContext = {},
): Promise<{ userId: string }> {
  const address = normaliseEmail(email);

  // Registration is rate limited harder than sign-in (3 per hour) precisely
  // because it has to reveal whether an email is taken. Without this it is an
  // account-enumeration oracle that anyone can query at will.
  await enforce("signup", context.ip, address);

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email: address,
        passwordHash,
        ...(name === undefined ? {} : { name }),
      },
    });
    return { userId: user.id };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: unknown }).code === "P2002"
    ) {
      await recordSecurityEvent("auth.signup.duplicate", {
        ...(context.ip === undefined ? {} : { ip: context.ip }),
        email: address,
      });
      throw new EmailAlreadyRegisteredError();
    }
    throw e;
  }
}

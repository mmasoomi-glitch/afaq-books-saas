import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db/client.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";
import { AuthError } from "./errors.js";
import type { OrgScope } from "./scope.js";
import { resolveOrgScope } from "./scope.js";

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

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

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

export interface SignInResult {
  rawToken: string;
  userId: string;
  expires: Date;
}

export async function signIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user === null || user.passwordHash === null) {
    // Spend comparable time before failing, so the response does not reveal
    // whether the address exists. A user row with no passwordHash is an
    // OAuth-only account and is treated identically.
    await verifyAgainstDummy(password);
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new InvalidCredentialsError();
  }

  const rawToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: hashSessionToken(rawToken),
      expires,
    },
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

  if (session.expires.getTime() <= Date.now()) {
    // Removed on sight rather than left to accumulate. A sweeper job can still
    // exist later for sessions nobody ever presents again.
    await prisma.session.delete({ where: { id: session.id } });
    throw new SessionExpiredError();
  }

  return { userId: session.userId, expires: session.expires };
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
): Promise<{ userId: string }> {
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
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
      throw new EmailAlreadyRegisteredError();
    }
    throw e;
  }
}

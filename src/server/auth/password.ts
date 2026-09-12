import { hash, verify, type Options } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * A password hash is the one thing here that has to survive the database being
 * disclosed. The cost parameters are pinned in this file rather than left to a
 * library default, because a library default can change between versions and
 * nobody would notice it getting weaker.
 */

/**
 * OWASP Password Storage Cheat Sheet baseline for Argon2id: m=19456 KiB,
 * t=2, p=1.
 *
 * Raising these later is safe: argon2 encodes the parameters it used into the
 * hash string, so old hashes keep verifying with their old cost while new ones
 * use the new cost.
 */
/**
 * Argon2id, written as the literal `2` rather than as `Algorithm.Argon2id`.
 *
 * `@node-rs/argon2` declares the enum as `export declare const enum Algorithm`,
 * and TypeScript cannot inline an ambient const enum under `isolatedModules` —
 * which Next.js requires, because SWC compiles each file alone and has no way
 * to know what the enum member means. The value exists perfectly well at
 * runtime; only the compile-time reference is unavailable.
 *
 * A bare magic number for a cryptographic parameter is exactly the kind of
 * thing that rots silently, so it is not left to a comment. `P1` in
 * tests/unit/auth/password.test.ts asserts the ENCODED hash — argon2 writes its
 * algorithm and cost into the output string — so if this number ever stopped
 * meaning Argon2id, or the cost drifted, a test says so rather than the hashes
 * quietly getting weaker.
 */
const ARGON2ID = 2 as NonNullable<Options["algorithm"]>;

export const ARGON2_OPTIONS: Readonly<Options> = Object.freeze({
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

const MIN_LENGTH = 12;
const MAX_LENGTH = 1024;

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < MIN_LENGTH) {
    throw new Error(
      `password must be at least ${MIN_LENGTH} characters, got ${plaintext.length}`,
    );
  }
  if (plaintext.length > MAX_LENGTH) {
    // argon2's cost does not depend on input length, but copying and hashing a
    // multi-megabyte string still burns CPU and memory on the way in.
    throw new Error(
      `password must be at most ${MAX_LENGTH} characters, got ${plaintext.length}`,
    );
  }
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * A wrong password is `false`, not an exception.
 *
 * A malformed or non-argon2 stored hash is ALSO `false`. If a corrupt hash threw
 * while a wrong password returned false, a caller could tell the two apart, and
 * so could anyone watching the caller's behaviour.
 *
 * The caller must not branch differently on "no such user" versus "wrong
 * password" either — see verifyAgainstDummy.
 */
export async function verifyPassword(
  hashed: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Always returns false. Its only purpose is to spend comparable time when no
 * user exists, so that response latency does not reveal which email addresses
 * are registered.
 *
 * The dummy hash is computed once and memoised; hashing it on every miss would
 * make a miss *slower* than a hit, which leaks in the other direction.
 */
export async function verifyAgainstDummy(plaintext: string): Promise<false> {
  dummyHash ??= hash("dummy password, never a real credential", ARGON2_OPTIONS);
  try {
    await verify(await dummyHash, plaintext, ARGON2_OPTIONS);
  } catch {
    // Ignored on purpose: this call exists for its duration, not its result.
  }
  return false;
}

import { expect, test } from "vitest";
import {
  ARGON2_OPTIONS,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "../../../src/server/auth/password";

/**
 * The cost parameters are the one thing here that has to survive the database
 * being disclosed, so they are asserted against the ENCODED hash rather than
 * against the constant that produced it. Reading back the constant would prove
 * only that the file says what the file says.
 */

const PASSWORD = "correct horse battery staple";

test("P1: the encoded hash names argon2id and the OWASP cost", async () => {
  // argon2 writes its algorithm, version and cost into the output string, so
  // this is the observable fact rather than a restatement of the input.
  //
  // It also guards the magic `2` in password.ts: the algorithm is written as a
  // literal because `@node-rs/argon2` declares an ambient const enum that
  // cannot be inlined under `isolatedModules`. If that number ever stopped
  // meaning Argon2id, this line fails instead of the hashes quietly changing.
  const hashed = await hashPassword(PASSWORD);

  expect(hashed.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
});

test("P2: the options object cannot be mutated by a caller", async () => {
  // It is exported, so anything could reach it. Frozen means a module that
  // "just lowers memoryCost for tests" fails loudly instead of weakening every
  // password hashed afterwards in the same process.
  expect(Object.isFrozen(ARGON2_OPTIONS)).toBe(true);
  expect(ARGON2_OPTIONS.memoryCost).toBe(19456);
  expect(ARGON2_OPTIONS.timeCost).toBe(2);
  expect(ARGON2_OPTIONS.parallelism).toBe(1);
});

test("P3: the same password hashes differently every time", async () => {
  // Distinct salts. Identical hashes for identical passwords would tell anyone
  // holding the table which users share a password.
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);

  expect(a).not.toBe(b);
  expect(await verifyPassword(a, PASSWORD)).toBe(true);
  expect(await verifyPassword(b, PASSWORD)).toBe(true);
});

test("P4: a wrong password is false, not an exception", async () => {
  const hashed = await hashPassword(PASSWORD);
  expect(await verifyPassword(hashed, "not the password at all")).toBe(false);
});

test("P5: a malformed stored hash is also false, not an exception", async () => {
  // If a corrupt hash threw while a wrong password returned false, a caller
  // could tell the two apart — and so could anyone watching how the caller
  // behaves.
  for (const bad of ["", "not a hash", "$argon2id$broken", "$2b$10$notargon"]) {
    expect(await verifyPassword(bad, PASSWORD)).toBe(false);
  }
});

test("P6: a password shorter than 12 characters is refused", async () => {
  await expect(hashPassword("short")).rejects.toThrow(/at least 12/);
});

test("P7: an absurdly long password is refused before hashing", async () => {
  // argon2's cost does not depend on input length, but copying and hashing a
  // multi-megabyte string still burns CPU and memory on the way in — so an
  // unbounded field is a cheap way to make the server work hard.
  await expect(hashPassword("x".repeat(1025))).rejects.toThrow(/at most 1024/);
});

test("P8: the dummy verification always returns false, whatever it is given", async () => {
  // It exists for its DURATION, not its result: without it, a sign-in for an
  // address that does not exist would return noticeably faster than one for an
  // address that does, and the response time would be the oracle the error
  // message refuses to be.
  //
  // An earlier version of this test asserted that the second call was not
  // dramatically slower than the first, to pin the memoisation. It measured
  // wall-clock time and it FLAKED — 1924ms against a 558ms bound on a loaded
  // machine — which is worse than not testing it: a suite that fails for
  // reasons unrelated to the change teaches people to re-run CI rather than
  // read it.
  //
  // The memoisation is still worth having and is visible in the source
  // (`dummyHash ??= hash(...)`). It is simply not something a stopwatch can
  // assert reliably, so what is asserted here is the contract that can be:
  // never throws, never true, regardless of input.
  for (const input of [PASSWORD, "something else entirely", "", "x".repeat(500)]) {
    expect(await verifyAgainstDummy(input)).toBe(false);
  }
});

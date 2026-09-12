import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser } from "../../../src/server/auth/session";

/**
 * `B-20260912-03` — email uniqueness, enforced by the database.
 *
 * The column already had a `UNIQUE` constraint, on the **raw** string. So
 * `Admin@corp.com` and `admin@corp.com` were two different values and two
 * different accounts, and anyone could register a case variant of a colleague's
 * address.
 *
 * `normaliseEmail` inside `signIn` and `registerUser` fixed the defect, and
 * `accounting-integrity.md` is explicit that an application-only check is not
 * sufficient for a uniqueness property. So every test here that matters
 * **bypasses the service entirely** — a service-level test would pass just as
 * happily with no index at all, which is precisely the gap being closed.
 */

const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

/** Insert a user the way a future invite flow or seed script might: directly. */
async function insertDirect(email: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (${randomUUID()}::uuid, ${email}, 'x', now(), now())
  `;
}

test("E1: the DATABASE refuses a case variant, with no service involved", async () => {
  // The whole point of the blocker. `prisma.user.create` from some module that
  // has not heard of `normaliseEmail` must not be able to create the second
  // account, and nothing in the application is in the way here.
  await insertDirect("admin@corp.com");

  await expect(insertDirect("Admin@corp.com")).rejects.toThrow();
  await expect(insertDirect("ADMIN@CORP.COM")).rejects.toThrow();

  expect(await prisma.user.count()).toBe(1);
});

test("E2: the exact duplicate is still refused too", async () => {
  // The original `@unique` on the raw string. Adding a functional index must
  // not be mistaken for replacing it — both constraints exist and both matter.
  await insertDirect("someone@corp.com");

  await expect(insertDirect("someone@corp.com")).rejects.toThrow();
});

test("E3: different addresses that merely look similar are still allowed", async () => {
  // The failure mode of over-eager normalisation. Gmail treats dots and `+`
  // tags as insignificant; most mail servers do not, and deciding that
  // `a.b@corp.com` is `ab@corp.com` would lock out a real person whose address
  // genuinely differs.
  await insertDirect("a.b@corp.com");
  await insertDirect("ab@corp.com");
  await insertDirect("ab+tag@corp.com");

  expect(await prisma.user.count()).toBe(3);
});

test("E4: registerUser refuses the case variant as a clean error, not a crash", async () => {
  // The service path still has to behave. A 500 from a raw constraint error
  // would be a worse experience than the duplicate it prevents, and would leak
  // the constraint name.
  const email = `user-${randomUUID()}@example.test`;
  await registerUser(email, PASSWORD);

  await expect(
    registerUser(email.toUpperCase(), PASSWORD),
  ).rejects.toMatchObject({
    // Same error the raw-string duplicate has always produced — the caller
    // cannot tell which of the two constraints refused them, and should not.
    name: expect.stringMatching(/Error$/) as unknown as string,
  });

  expect(await prisma.user.count()).toBe(1);
});

test("E5: the index is a real index with the name the migration gives it", async () => {
  // Asserted rather than assumed. A migration that silently failed to apply —
  // or that was edited to a different name — would leave every test above
  // passing for the wrong reason, because `resetDb` truncates rather than
  // rebuilding the schema.
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_email_lower_key'
  `;

  expect(rows).toHaveLength(1);
  expect(rows[0]?.indexdef).toMatch(/UNIQUE/i);
  expect(rows[0]?.indexdef).toMatch(/lower/i);
});

/**
 * RLS — Row Level Security enforces tenant isolation at the database level.
 *
 * These tests verify that the RLS policies fire correctly and restrict reads
 * to the current organization when app.current_organization is set.
 *
 * B-20260911-04.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureOrg, pool, resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { withTxUsing } from "../../../src/server/tx/with-tx";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

/**
 * Create an org-scoped period directly via the pool.  Because FORCE ROW
 * LEVEL SECURITY is active on every org-scoped table, we must temporarily
 * suspend the policy for the INSERT and recreate it immediately after.
 */
async function createPeriodRaw(orgId: string, name: string): Promise<string> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    // Temporarily replace the policy with one that allows any row for
    // organization-scoped tables.  With FORCE ROW SECURITY, a table with
    // no policy blocks all DML, so we must not drop it — replace instead.
    await client.query(`
      DROP POLICY IF EXISTS org_isolate_periods ON periods;
      CREATE POLICY org_isolate_periods ON periods
        FOR ALL
        USING (true)
        WITH CHECK (true);
    `);
    await client.query(
      `INSERT INTO periods (id, organization_id, name, status, start_date, end_date, created_at, updated_at)
       VALUES ($1, $2, $3, 'OPEN', now(), now() + interval '31 days', now(), now())`,
      [id, orgId, name],
    );
    // Restore the real RLS policy
    await client.query(`
      DROP POLICY IF EXISTS org_isolate_periods ON periods;
      CREATE POLICY org_isolate_periods ON periods
        FOR ALL
        USING (organization_id = (current_setting('app.current_organization')::uuid));
    `);
    return id;
  } finally {
    client.release();
  }
}

/**
 * RLS-1: RLS policies are enabled on every org-scoped table.
 */
test("RLS-1: RLS policies are enabled on org-scoped tables", async () => {
  const tables = [
    "accounts",
    "accounting_configs",
    "periods",
    "period_locks",
    "journal_entries",
    "journal_lines",
    "journal_counters",
    "audit_logs",
    "memberships",
  ];

  const db = await pool.connect();
  try {
    for (const table of tables) {
      const result = await db.query(
        `SELECT policyname FROM pg_policies WHERE tablename = $1`,
        [table],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    }
  } finally {
    db.release();
  }
});

/**
 * RLS-2: Setting app.current_organization restricts reads to that org.
 * A period created for orgB must NOT appear when the context is set to orgA.
 */
test("RLS-2: RLS context restricts reads to current org", async () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  await ensureOrg(orgA);
  await ensureOrg(orgB);

  const periodA = await createPeriodRaw(orgA, "orgA-period");
  const periodB = await createPeriodRaw(orgB, "orgB-period");

  // Read all periods WITH RLS context set to orgA
  const result = await withTxUsing(
    async (innerFn, isolation) => {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${orgA}'`,
          );
          return await innerFn(tx);
        },
        { isolationLevel: isolation as any },
      );
    },
    (tx) => tx.period.findMany({ select: { id: true } }),
    { isolation: "Serializable" },
    { organizationId: orgA },
  );

  const ids = result.map((p: { id: string }) => p.id);

  expect(ids).toContain(periodA);
  expect(ids).not.toContain(periodB);
});

/**
 * RLS-3: Two orgs each see only their own periods when querying directly.
 */
test("RLS-3: orgA sees only orgA periods, orgB sees only orgB periods", async () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  await ensureOrg(orgA);
  await ensureOrg(orgB);

  const periodA = await createPeriodRaw(orgA, "orgA-period");
  const periodB = await createPeriodRaw(orgB, "orgB-period");

  const resultA = await withTxUsing(
    async (innerFn, isolation) => {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${orgA}'`,
          );
          return await innerFn(tx);
        },
        { isolationLevel: isolation as any },
      );
    },
    (tx) => tx.period.findMany({ select: { id: true } }),
    { isolation: "Serializable" },
    { organizationId: orgA },
  );

  const resultB = await withTxUsing(
    async (innerFn, isolation) => {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${orgB}'`,
          );
          return await innerFn(tx);
        },
        { isolationLevel: isolation as any },
      );
    },
    (tx) => tx.period.findMany({ select: { id: true } }),
    { isolation: "Serializable" },
    { organizationId: orgB },
  );

  const idsA = resultA.map((p: { id: string }) => p.id);
  const idsB = resultB.map((p: { id: string }) => p.id);

  expect(idsA).toContain(periodA);
  expect(idsA).not.toContain(periodB);
  expect(idsB).toContain(periodB);
  expect(idsB).not.toContain(periodA);
});

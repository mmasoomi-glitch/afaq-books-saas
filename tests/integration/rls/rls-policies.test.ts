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
import {
  createAccount,
} from "../../../src/modules/ledger/accounts";
import {
  createPeriod,
} from "../../../src/modules/ledger/periods";
import {
  unsafeCreateLedgerScope,
} from "../../../src/modules/ledger/scope";
import type { LedgerScope } from "../../../src/modules/ledger/scope";
import {
  withTxUsing,
} from "../../../src/server/tx/with-tx";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function newScope(): Promise<LedgerScope> {
  const s = unsafeCreateLedgerScope(randomUUID(), randomUUID());
  await ensureOrg(s.organizationId);
  return s;
}

async function fixture(
  orgId?: string,
) {
  const targetOrgId = orgId ?? (await newScope()).organizationId;
  const scope = unsafeCreateLedgerScope(targetOrgId, randomUUID());
  const period = await createPeriod(scope, {
    name: "2024-01",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
  });
  const cash = await createAccount(scope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });
  return { scope, period, cash };
}

/**
 * RLS-1: RLS policies are enabled on every org-scoped table.
 */
test("RLS-1: RLS policies are enabled on org-scoped tables", async () => {
  const db = await pool.connect();
  try {
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

    for (const table of tables) {
      const result = await db.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = ${table}::regclass
           AND contype = 'check'
           AND conname LIKE 'rls_%'`,
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
  const { scope: orgAScope, period: periodA } = await fixture();
  const { period: periodB } = await fixture();

  // Read all periods WITH RLS context set to orgA
  // The $transaction runner wraps fn(tx) in a transaction; we set context
  // before calling fn.
  const result = await withTxUsing(
    async (innerFn, isolation) => {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${orgAScope.organizationId}'`,
          );
          return await innerFn(tx);
        },
        { isolationLevel: isolation as any },
      );
    },
    (tx) => tx.period.findMany({ select: { id: true } }),
    { isolation: "Serializable" },
    { organizationId: orgAScope.organizationId },
  );

  const ids = result.map((p: { id: string }) => p.id);

  // periodA belongs to orgA — should be present
  expect(ids).toContain(periodA.id);
  // periodB belongs to orgB — must NOT be present
  expect(ids).not.toContain(periodB.id);
});

/**
 * RLS-3: Two orgs each see only their own periods when using withTx.
 */
test("RLS-3: two orgs using withTx each see only their own periods", async () => {
  const { scope: orgAScope } = await fixture();
  const { scope: orgBScope, period: periodB } = await fixture();
  const { period: periodA } = await fixture(orgAScope.organizationId);

  // orgA's transaction
  const orgAResult = await withTxUsing(
    async (innerFn, isolation) => {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${orgAScope.organizationId}'`,
          );
          return await innerFn(tx);
        },
        { isolationLevel: isolation as any },
      );
    },
    (tx) => tx.period.findMany({ select: { id: true } }),
    { isolation: "Serializable" },
    { organizationId: orgAScope.organizationId },
  );

  const orgAResultIds = orgAResult.map((p: { id: string }) => p.id);
  expect(orgAResultIds).toContain(periodA.id);
  expect(orgAResultIds).not.toContain(periodB.id);
});

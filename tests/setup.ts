import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadEnv } from "./load-env.js";

loadEnv();

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error("TEST_DATABASE_URL is not set");
}

// Prisma resolves its connection from DATABASE_URL (see prisma/schema.prisma),
// not from TEST_DATABASE_URL. Without this line the service layer under test
// would write to the DEVELOPMENT database while the assertions read the test
// database — every test would pass while proving nothing, and a test run would
// quietly mutate dev data.
process.env.DATABASE_URL = testDbUrl;

// Apply the real migration — including the raw SQL that carries every
// database-level invariant — to the test database before the suite runs.
//
// Resolve the Prisma binary from node_modules rather than shelling out to
// `npx`: under pnpm, `npx prisma` is not reliably on PATH and fails in CI.
// Fall back to `pnpm exec` only if the binary is genuinely absent.
function applyMigrations(databaseUrl: string): void {
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const local = resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  const [cmd, args] = existsSync(local)
    ? ([local, ["migrate", "deploy"]] as const)
    : (["pnpm", ["exec", "prisma", "migrate", "deploy"]] as const);

  try {
    // Capture output instead of discarding it. `stdio: "ignore"` turns any
    // migration failure into "Command failed" with no cause, which is the
    // worst possible message to debug from a CI log.
    execFileSync(cmd, [...args], { env, stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `prisma migrate deploy failed against the test database.\n` +
        `stdout:\n${err.stdout ?? "(none)"}\n` +
        `stderr:\n${err.stderr ?? "(none)"}\n` +
        `cause: ${err.message ?? String(e)}`,
    );
  }
}

applyMigrations(testDbUrl);

const pool = new Pool({ connectionString: testDbUrl });

export { pool };

export async function resetDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      TRUNCATE TABLE journal_lines, journal_entries, period_locks, audit_logs,
        journal_counters, periods, accounts, accounting_configs
      RESTART IDENTITY CASCADE
    `);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

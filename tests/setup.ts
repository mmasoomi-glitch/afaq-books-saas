import { execSync } from "node:child_process";
import { Pool } from "pg";
import { loadEnv } from "./load-env.js";

loadEnv();

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error("TEST_DATABASE_URL is not set");
}

execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: testDbUrl },
  stdio: "ignore",
});

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

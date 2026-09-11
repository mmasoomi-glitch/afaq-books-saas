import { test, beforeAll, beforeEach } from "vitest";
import { ensureOrg, pool, resetDb } from "../../setup";
import type { QueryResultRow } from "pg";

function one<T>(arr: T[], msg = "expected at least one row"): T {
  const v = arr[0];
  if (v === undefined) throw new Error(msg);
  return v;
}

function computeReportingAmount(debit: string, credit: string, fxRate: string): string {
  const d = parseFloat(debit);
  const c = parseFloat(credit);
  const f = parseFloat(fxRate);
  return (Math.round((d + c) * f * 10000) / 10000).toString();
}

async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

// Create test data helpers
async function createAccount(
  orgId: string,
  code: string,
  type: string,
  currency = "USD",
  parentId?: string
): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO accounts (id, organization_id, code, name, type, currency, parent_id, is_active) VALUES ($1, $2, $3, $3, $4, $5, $6, true)",
    [id, orgId, code, type, currency, parentId]
  );
  return id;
}

async function createPeriod(
  orgId: string,
  name: string,
  startDate: string,
  endDate: string,
  status = "OPEN"
): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO periods (id, organization_id, name, start_date, end_date, status) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, orgId, name, startDate, endDate, status]
  );
  return id;
}

async function createJournalEntry(
  orgId: string,
  periodId: string,
  journalNumber: number | null,
  entryDate: string,
  description: string,
  postedAt: string | null,
  postedBy: string | null,
  reversalOfId?: string,
  reversedById?: string
): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO journal_entries (id, organization_id, period_id, journal_number, entry_date, description, source_module, currency, posted_at, posted_by, reversal_of_id, reversed_by_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      orgId,
      periodId,
      journalNumber,
      entryDate,
      description,
      "manual",
      "USD",
      postedAt,
      postedBy,
      reversalOfId || null,
      reversedById || null,
    ]
  );
  return id;
}

async function createJournalLine(
  orgId: string,
  journalEntryId: string,
  accountId: string,
  lineNumber: number,
  debit: string,
  credit: string,
  currency: string = "USD",
  fxRate: string = "1",
  reportingAmount: string = computeReportingAmount(debit, credit, fxRate)
): Promise<void> {
  await query(
    `INSERT INTO journal_lines (id, organization_id, journal_entry_id, account_id, line_number, debit, credit, currency, fx_rate, reporting_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [crypto.randomUUID(), orgId, journalEntryId, accountId, lineNumber, debit, credit, currency, fxRate, reportingAmount]
  );
}

async function createPostedEntry(
  orgId: string,
  periodId: string,
  journalNumber: number,
  entryDate: string,
  description: string,
  postedBy: string,
  lines?: Array<{ accountId: string; lineNumber: number; debit: string; credit: string }>
): Promise<{ entryId: string; lineIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entryId = crypto.randomUUID();
    await client.query(
      `INSERT INTO journal_entries (id, organization_id, period_id, journal_number, entry_date, description, source_module, currency, posted_at, posted_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [entryId, orgId, periodId, null, entryDate, description, "manual", "USD", null, null]
    );
    // A posted entry must have balanced lines, so when the caller does not
    // care about the specific lines we create a balanced pair (and the two
    // accounts they post to) inside the same transaction. Without this the
    // deferred je_balanced_check correctly rejects the COMMIT.
    let effectiveLines = lines;
    if (effectiveLines === undefined || effectiveLines.length === 0) {
      const drId = crypto.randomUUID();
      const crId = crypto.randomUUID();
      const suffix = entryId.slice(0, 8);
      await client.query(
        "INSERT INTO accounts (id, organization_id, code, name, type, currency, is_active) VALUES ($1, $2, $3, $3, $4, $5, true)",
        [drId, orgId, `AUTO-DR-${suffix}`, "ASSET", "USD"]
      );
      await client.query(
        "INSERT INTO accounts (id, organization_id, code, name, type, currency, is_active) VALUES ($1, $2, $3, $3, $4, $5, true)",
        [crId, orgId, `AUTO-CR-${suffix}`, "INCOME", "USD"]
      );
      effectiveLines = [
        { accountId: drId, lineNumber: 1, debit: "100", credit: "0" },
        { accountId: crId, lineNumber: 2, debit: "0", credit: "100" },
      ];
    }

    const lineIds: string[] = [];
    {
      for (const line of effectiveLines) {
        const lineId = crypto.randomUUID();
        const r = computeReportingAmount(line.debit, line.credit, "1");
        await client.query(
          `INSERT INTO journal_lines (id, organization_id, journal_entry_id, account_id, line_number, debit, credit, currency, fx_rate, reporting_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [lineId, orgId, entryId, line.accountId, line.lineNumber, line.debit, line.credit, "USD", "1", r]
        );
        lineIds.push(lineId);
      }
    }
    const postedAt = new Date().toISOString();
    await client.query(
      `UPDATE journal_entries SET posted_at = $1, journal_number = $2, posted_by = $3 WHERE id = $4`,
      [postedAt, journalNumber, postedBy, entryId]
    );
    await client.query("COMMIT");
    return { entryId, lineIds };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  // Ensure clean state
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

// ============================================================
// (A) journal_lines column checks
// ============================================================

test("A1: jl_debit_credit_sign - rejects row where both debit and credit are positive", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  await createAccount(orgId, "REV", "INCOME");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const accountId = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  try {
    await createJournalLine(orgId, entryId, one(accountId).id, 1, "100", "100");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("jl_debit_credit_sign")) {
      return;
    }
    throw e;
  }
});

test("A2: jl_debit_credit_sign - allows row where debit is positive and credit is zero", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  await createAccount(orgId, "REV", "INCOME");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0");
  const rows = await query("SELECT * FROM journal_lines WHERE journal_entry_id = $1", [entryId]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

test("A3: jl_debit_credit_sign - allows row where credit is positive and debit is zero", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "0", "100");
  const rows = await query("SELECT * FROM journal_lines WHERE journal_entry_id = $1", [entryId]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

test("A4: jl_nonzero - rejects row where both debit and credit are zero", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  try {
    await createJournalLine(orgId, entryId, one(acc).id, 1, "0", "0");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("jl_nonzero")) {
      return;
    }
    throw e;
  }
});

test("A5: jl_fx_rate_positive - rejects row where fx_rate is zero", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  try {
    await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0", "USD", "0", "100");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("jl_fx_rate_positive")) {
      return;
    }
    throw e;
  }
});

test("A6: jl_fx_rate_positive - allows row where fx_rate is positive", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0", "USD", "1.5", "150");
  const rows = await query("SELECT * FROM journal_lines WHERE journal_entry_id = $1", [entryId]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

test("A7: jl_reporting_amount_consistent - rejects mismatched reporting_amount", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  try {
    // debit=100, credit=0, fx_rate=1, so reporting_amount should be 100, but we pass 999
    await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0", "USD", "1", "999");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("jl_reporting_amount_consistent")) {
      return;
    }
    throw e;
  }
});

test("A8: jl_reporting_amount_consistent - allows correct reporting_amount", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0", "USD", "1", "100");
  const rows = await query("SELECT * FROM journal_lines WHERE journal_entry_id = $1", [entryId]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

// ============================================================
// (B) journal_entries checks
// ============================================================

test("B1: je_number_iff_posted - rejects row where posted_at is set but journal_number is null", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  try {
    await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", "2024-01-01 12:00:00+00", null);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("je_number_iff_posted")) {
      return;
    }
    throw e;
  }
});

test("B2: je_number_iff_posted - rejects row where journal_number is set but posted_at is null", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  try {
    await createJournalEntry(orgId, periodId, 1, "2024-01-01", "Test", null, null);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("je_number_iff_posted")) {
      return;
    }
    throw e;
  }
});

test("B3: je_number_iff_posted - allows row where both journal_number and posted_at are null (unposted)", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const rows = await query("SELECT * FROM journal_entries WHERE description = $1", ["Test"]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

test("B4: je_number_iff_posted - allows row where both journal_number and posted_at are set (posted)", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001");
  const rows = await query("SELECT * FROM journal_entries WHERE description = $1", ["Test"]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

test("B5: je_posted_by_iff_posted - rejects posted_at without posted_by", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  try {
    await createJournalEntry(orgId, periodId, 1, "2024-01-01", "Test", "2024-01-01 12:00:00+00", null);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("je_posted_by_iff_posted")) {
      return;
    }
    throw e;
  }
});

test("B6: je_posted_by_iff_posted - allows posted_at with posted_by", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const byId = "00000000-0000-0000-0000-000000000001";
  await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", byId);
  const rows = await query("SELECT * FROM journal_entries WHERE description = $1", ["Test"]);
  if (rows.length !== 1) throw new Error("Row not inserted");
});

// ============================================================
// (C) periods checks + non-overlap
// ============================================================

test("C1: period_dates_ordered - rejects period where end_date < start_date", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  try {
    await createPeriod(orgId, "P1", "2024-02-01", "2024-01-01");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("period_dates_ordered")) {
      return;
    }
    throw e;
  }
});

test("C2: period_dates_ordered - allows period where end_date >= start_date", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const pid = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  if (!pid) throw new Error("Period not created");
});

test("C3: period_dates_ordered - allows period where end_date = start_date", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const pid = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-01");
  if (!pid) throw new Error("Period not created");
});

test("C4: period_no_overlap - rejects overlapping period for same organization", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createPeriod(orgId, "P1", "2024-01-01", "2024-03-31");
  try {
    await createPeriod(orgId, "P2", "2024-02-01", "2024-04-30");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("conflicting key") || err.message.includes("period_no_overlap") || err.message.includes("ExclusionConstraint")) {
      return;
    }
    throw e;
  }
});

test("C5: period_no_overlap - allows non-overlapping period for same organization", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const pid = await createPeriod(orgId, "P2", "2024-02-01", "2024-02-29");
  if (!pid) throw new Error("Period not created");
});

test("C6: fiscal_month_range - rejects fiscal_year_start_month < 1", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  try {
    await query(
      "INSERT INTO accounting_configs (id, organization_id, base_currency, fiscal_year_start_month) VALUES ($1, $2, $3, $4)",
      [crypto.randomUUID(), orgId, "USD", 0]
    );
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("fiscal_month_range")) {
      return;
    }
    throw e;
  }
});

test("C7: fiscal_month_range - rejects fiscal_year_start_month > 12", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  try {
    await query(
      "INSERT INTO accounting_configs (id, organization_id, base_currency, fiscal_year_start_month) VALUES ($1, $2, $3, $4)",
      [crypto.randomUUID(), orgId, "USD", 13]
    );
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("violates constraint") || err.message.includes("fiscal_month_range")) {
      return;
    }
    throw e;
  }
});

test("C8: fiscal_month_range - allows fiscal_year_start_month = 1", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await query(
    "INSERT INTO accounting_configs (id, organization_id, base_currency, fiscal_year_start_month) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), orgId, "USD", 1]
  );
  const rows = await query("SELECT * FROM accounting_configs WHERE organization_id = $1", [orgId]);
  if (rows.length !== 1) throw new Error("Config not created");
});

test("C9: fiscal_month_range - allows fiscal_year_start_month = 12", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await query(
    "INSERT INTO accounting_configs (id, organization_id, base_currency, fiscal_year_start_month) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), orgId, "USD", 12]
  );
  const rows = await query("SELECT * FROM accounting_configs WHERE organization_id = $1", [orgId]);
  if (rows.length !== 1) throw new Error("Config not created");
});

// ============================================================
// (D) TRIGGER: jl_org_consistency
// ============================================================

test("D1: jl_org_consistency - rejects line with mismatched organization_id", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const org2Id = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const account = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  try {
    await createJournalLine(org2Id, entryId, one(account).id, 1, "100", "0");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("organization mismatch") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

// ============================================================
// (E) TRIGGER: je_immutable / jl_immutable
// ============================================================

test("E1: je_immutable - rejects UPDATE on posted journal entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const { entryId } = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001");
  try {
    await query("UPDATE journal_entries SET description = 'Modified' WHERE id = $1", [entryId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot be modified") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("E2: je_immutable - rejects DELETE on posted journal entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const { entryId } = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001");
  try {
    await query("DELETE FROM journal_entries WHERE id = $1", [entryId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot be deleted") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("E3: je_immutable - allows UPDATE on unposted journal entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  await query("UPDATE journal_entries SET description = 'Modified' WHERE id = $1", [entryId]);
  const rows = await query("SELECT description FROM journal_entries WHERE id = $1", [entryId]);
  if (one(rows).description !== "Modified") throw new Error("Update did not apply");
});

test("E4: jl_immutable - rejects INSERT line on posted journal entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const { entryId } = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001");
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  try {
    await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0");
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot add a line") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("E5: jl_immutable - rejects DELETE on posted journal line", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  await createAccount(orgId, "REV", "INCOME");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  const rev = await query<{ id: string }>("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "REV"]);
  const { lineIds } = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001", [
    { accountId: one(acc).id, lineNumber: 1, debit: "100", credit: "0" },
    { accountId: one(rev).id, lineNumber: 2, debit: "0", credit: "100" },
  ]);
  try {
    await query("DELETE FROM journal_lines WHERE id = $1", [lineIds[0]!]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot be modified") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

// ============================================================
// (F) DEFERRED CONSTRAINT: je_assert_balanced
// ============================================================

test("F1: je_assert_balanced - rejects posting unbalanced entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0");
  try {
    await query("UPDATE journal_entries SET posted_at = $1, posted_by = $2, journal_number = $3 WHERE id = $4", ["2024-01-01 12:00:00+00", "00000000-0000-0000-0000-000000000001", 1, entryId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("unbalanced") || err.message.includes("trigger") || err.message.includes("constraint")) {
      return;
    }
    throw e;
  }
});

test("F2: je_assert_balanced - allows posting balanced entry", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  await createAccount(orgId, "CASH", "ASSET");
  await createAccount(orgId, "REV", "INCOME");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  const acc = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "CASH"]);
  const rev = await query("SELECT id FROM accounts WHERE organization_id = $1 AND code = $2", [orgId, "REV"]);
  await createJournalLine(orgId, entryId, one(acc).id, 1, "100", "0");
  await createJournalLine(orgId, entryId, one(rev).id, 2, "0", "100");
  await query("UPDATE journal_entries SET posted_at = $1, posted_by = $2, journal_number = $3 WHERE id = $4", ["2024-01-01 12:00:00+00", "00000000-0000-0000-0000-000000000001", 1, entryId]);
  const rows = await query("SELECT * FROM journal_entries WHERE id = $1", [entryId]);
  if (one(rows).posted_at === null) throw new Error("Entry was not posted");
});

// ============================================================
// (G) TRIGGER: je_period_open
// ============================================================

test("G1: je_period_open - rejects posting into CLOSED period", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31", "CLOSED");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  try {
    await query("UPDATE journal_entries SET posted_at = $1, posted_by = $2, journal_number = $3 WHERE id = $4", ["2024-01-01 12:00:00+00", "00000000-0000-0000-0000-000000000001", 1, entryId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot post") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("G2: je_period_open - rejects posting into LOCKED period", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31", "LOCKED");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Test", null, null);
  try {
    await query("UPDATE journal_entries SET posted_at = $1, posted_by = $2, journal_number = $3 WHERE id = $4", ["2024-01-01 12:00:00+00", "00000000-0000-0000-0000-000000000001", 1, entryId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot post") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("G3: je_period_open - allows posting into OPEN period", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31", "OPEN");
  const { entryId } = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Test", "00000000-0000-0000-0000-000000000001");
  const rows = await query("SELECT * FROM journal_entries WHERE id = $1", [entryId]);
  if (one(rows).posted_at === null) throw new Error("Entry was not posted");
});

// ============================================================
// (H) TRIGGER: append_only (audit_logs, period_locks)
// ============================================================

test("H1: audit_logs is append-only - rejects UPDATE on audit_logs", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const actorId = "00000000-0000-0000-0000-000000000001";
  await query(
    "INSERT INTO audit_logs (id, organization_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [crypto.randomUUID(), orgId, actorId, "CREATE", "account", crypto.randomUUID()]
  );
  try {
    await query("UPDATE audit_logs SET action = 'UPDATED' WHERE organization_id = $1", [orgId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("append-only") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("H2: audit_logs is append-only - rejects DELETE on audit_logs", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const actorId = "00000000-0000-0000-0000-000000000001";
  const logId = crypto.randomUUID();
  await query(
    "INSERT INTO audit_logs (id, organization_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [logId, orgId, actorId, "CREATE", "account", crypto.randomUUID()]
  );
  try {
    await query("DELETE FROM audit_logs WHERE id = $1", [logId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("append-only") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

test("H3: period_locks is append-only - rejects UPDATE on period_locks", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const actorId = "00000000-0000-0000-0000-000000000001";
  const lockId = crypto.randomUUID();
  await query(
    "INSERT INTO period_locks (id, organization_id, period_id, action, reason, actor_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [lockId, orgId, periodId, "LOCK", "Audit", actorId]
  );
  try {
    await query("UPDATE period_locks SET reason = 'Updated' WHERE id = $1", [lockId]);
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("append-only") || err.message.includes("trigger")) {
      return;
    }
    throw e;
  }
});

// ============================================================
// (E) Regression tests for two defects found reviewing the
//     immutability triggers. Both were silent: nothing raised,
//     the wrong thing simply happened.
// ============================================================

test("E6: je_immutable - DELETE on an UNPOSTED entry actually deletes it", async () => {
  // A BEFORE DELETE trigger that returns NEW returns NULL, and returning NULL
  // CANCELS the delete. The original trigger therefore made deleting a draft
  // entry a silent no-op: no error, row still there.
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Draft", null, null);

  await query("DELETE FROM journal_entries WHERE id = $1", [entryId]);

  const rows = await query("SELECT id FROM journal_entries WHERE id = $1", [entryId]);
  if (rows.length !== 0) {
    throw new Error("draft entry survived DELETE - the trigger cancelled the operation");
  }
});

test("E7: jl_immutable - DELETE on a line of an UNPOSTED entry actually deletes it", async () => {
  const orgId = await ensureOrg(crypto.randomUUID());
  const accountId = await createAccount(orgId, "CASH", "ASSET");
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const entryId = await createJournalEntry(orgId, periodId, null, "2024-01-01", "Draft", null, null);
  await createJournalLine(orgId, entryId, accountId, 1, "100", "0");

  const before = await query<{ id: string }>(
    "SELECT id FROM journal_lines WHERE journal_entry_id = $1",
    [entryId]
  );
  await query("DELETE FROM journal_lines WHERE id = $1", [one(before).id]);

  const after = await query("SELECT id FROM journal_lines WHERE journal_entry_id = $1", [entryId]);
  if (after.length !== 0) {
    throw new Error("draft line survived DELETE - the trigger cancelled the operation");
  }
});

test("E8: je_immutable - reversal link is allowed on a posted entry with NULL source_id", async () => {
  // The exception that permits setting reversed_by_id compared every column
  // with `=`. source_id and reversal_of_id are nullable, and NULL = NULL is
  // NULL, so the AND chain evaluated to NULL, the exception was not taken, and
  // a legitimate reversal link was rejected. IS NOT DISTINCT FROM fixes it.
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const actor = "00000000-0000-0000-0000-000000000001";

  const original = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Original", actor);
  const reversal = await createPostedEntry(orgId, periodId, 2, "2024-01-02", "Reversal", actor);

  // This is the only UPDATE a posted entry may ever accept.
  await query("UPDATE journal_entries SET reversed_by_id = $1 WHERE id = $2", [
    reversal.entryId,
    original.entryId,
  ]);

  const rows = await query<{ reversed_by_id: string | null }>(
    "SELECT reversed_by_id FROM journal_entries WHERE id = $1",
    [original.entryId]
  );
  if (one(rows).reversed_by_id !== reversal.entryId) {
    throw new Error("reversal link was not written");
  }
});

test("E9: je_immutable - any OTHER update to a posted entry is still rejected", async () => {
  // The exception must be narrow: only the NULL -> value transition of
  // reversed_by_id, with every other column unchanged.
  const orgId = await ensureOrg(crypto.randomUUID());
  const periodId = await createPeriod(orgId, "P1", "2024-01-01", "2024-01-31");
  const actor = "00000000-0000-0000-0000-000000000001";
  const posted = await createPostedEntry(orgId, periodId, 1, "2024-01-01", "Original", actor);
  const reversal = await createPostedEntry(orgId, periodId, 2, "2024-01-02", "Reversal", actor);

  try {
    await query(
      "UPDATE journal_entries SET reversed_by_id = $1, description = 'Tampered' WHERE id = $2",
      [reversal.entryId, posted.entryId]
    );
    throw new Error("Should have failed");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes("cannot be modified")) return;
    throw e;
  }
});

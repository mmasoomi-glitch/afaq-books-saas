# .claude/rules/accounting-integrity.md

These are the financial invariants. They are not negotiable. They apply to
every agent, especially LEDGER-CORE, SALES-AR, PROCUREMENT-AP,
BANKING-RECON and REPORTING-ANALYTICS.

---

## Core invariants

### I1. Double-entry balance
Every posted journal entry must satisfy `Σ debits = Σ credits` per
currency. The check happens in the service layer **and** as a database
constraint (or `BEFORE INSERT` trigger / deferred check). A service-only
check is insufficient.

### I2. Posted = immutable
Once a journal entry is posted (state moves out of `draft`), the rows
backing it are read-only. Correction happens through:

- a **reversal** entry that posts the inverse, linked to the original, or
- a controlled **adjustment** that creates a new entry, never an `UPDATE`
  on the original line.

`DELETE` on a posted line is forbidden. Schema-level constraint preferred
(e.g. `posted_at IS NULL` predicate on UPDATE/DELETE triggers, or a
"posted" partition that revokes write permission from the app role).

### I3. Period locks
An accounting period has states: `open`, `closed`, `locked`. Closing
prevents normal posting; locking prevents even adjusting entries
without an `unlock` action that is itself recorded in the audit trail.
The lock check is server-side; the UI may grey a button but that alone
is not enforcement.

### I4. Reports derive from the ledger
Trial balance, P&L, balance sheet and aging reports must read from the
posted-ledger tables. No report may use:

- a separately-maintained "summary" table updated by application code
  without being recomputable from the ledger;
- UI hardcoded values;
- aggregations cached in memory across requests.

A "materialized view" or precomputed aggregate is acceptable **only** if
it is provably derivable from the ledger and refreshed by a documented
process, with a test that compares it to a freshly-computed value.

### I5. Payment allocation is evidence
An invoice with status `paid` or `partially_paid` must have rows in the
`payment_allocation` (or equivalent) table linking it to a real payment
with a real ledger entry. No status field may be set without that
evidence.

### I6. Reconciliation is evidence
A bank transaction marked `reconciled` must have a matched ledger entry
recorded in a reconciliation table, with the user/timestamp who matched
it. UI badges without backing rows are forbidden.

### I7. Organization scope
Every financial row carries an `organization_id`. Every query, mutation,
list, report and export filters by it. There is no "global" view.
Tenant-isolation tests are required for every module that touches these
rows. See `security-tenancy.md`.

### I8. Currency and precision
- Amounts are stored as integer minor units (e.g. cents) or as
  fixed-precision decimal (`Decimal(18,4)` in Prisma) — never as
  JavaScript `number` in DB storage.
- Multi-currency journals must record the transaction currency, the
  reporting-currency amount, and the FX rate used. The FX rate source
  and timestamp are part of the evidence.

### I9. Audit trail
Every material financial action (post, reverse, void, adjust, allocate,
reconcile, period lock/unlock, role grant, schema-impacting admin
action) writes to an immutable audit-log table. The audit row stores:
actor, organization, timestamp, action, entity, before/after where
applicable, request id, IP if available.

### I10. AI is never financial truth
AI suggestions are stored as suggestions, not facts. They reference the
data they are grounded in. Accepting a suggestion creates an explicit,
audited human action that posts via the same code paths as a manual
entry. See `ai-hallucination-memory.md`.

---

## Implementation expectations on the Next.js + Prisma stack

- Use Prisma `$transaction` for any multi-table write that touches the
  ledger.
- For posting, reversal, payment allocation and period-lock enforcement,
  request `Serializable` isolation:

  ```ts
  await prisma.$transaction(async (tx) => { /* … */ },
    { isolationLevel: 'Serializable' });
  ```

  Be prepared for `40001` serialization-failure retries — implement
  bounded retry with exponential backoff in a single helper, with tests.
- For high-contention counters (invoice number, journal number per
  period), use a separate sequence table with `SELECT … FOR UPDATE`,
  not application-side `MAX()+1`.
- Use Postgres-level `CHECK`, `EXCLUSION`, `UNIQUE` and `DEFERRABLE`
  constraints. Application-only validation is insufficient for I1, I2,
  I3 and I7.
- Use Prisma migrations; review every migration for whether it preserves
  posted-ledger immutability and tenant scope. Migrations that touch
  ledger tables are LEDGER-CORE-owned regardless of who wrote them.

---

## Forbidden in financial code

- `prisma.posted_entry.update({ where: { id }, data: { amount } })` —
  silent edit of a posted line.
- `prisma.posted_entry.delete(...)` — silent delete.
- A report computed by summing UI rows in the React tree.
- A "payment success" mutation that flips `invoice.status = 'paid'`
  without writing an allocation row and ledger entry in the same
  transaction.
- A "reconciled" toggle that flips a flag without writing the matched
  bank-line ↔ ledger-line pairing.
- AI auto-categorizing a bank line and posting it without an explicit
  user accept action recorded in the audit log.

If you find yourself writing one of the above to "ship faster", stop and
open a blocker.

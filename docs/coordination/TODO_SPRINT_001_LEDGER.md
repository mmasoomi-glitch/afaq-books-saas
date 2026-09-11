# docs/coordination/TODO_SPRINT_001_LEDGER.md

Adherence tracker for [`INTENTION_CONTRACT.md`](INTENTION_CONTRACT.md)
v1 — sprint 001, ledger-first slice.

**One row per unit of work.** Each row cites the contract clause it
satisfies and the verification that proves it. A row moves to `done`
**only** when that verification has actually been run and its output
recorded in `SPRINT_BOARD.md`. Checking a box without running the
verification is a violation of clause **C5.2**.

Status vocabulary: `todo` · `doing` · `blocked` · `done`

---

## Phase 0 — Governance corrections

Branch: `chore/intention-contract-sprint-001`

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T0.1 | Apply `protect-develop` + `protect-main` rulesets | C6.2 | `gh api .../rules/branches/develop` returns `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` | **done** |
| T0.2 | Close blocker `B-20260527-01` with API evidence; record in `INTEGRATION_LOG.md` | C6.2 | `BLOCKERS.md` entry moved to Resolved with the verification output | **done** |
| T0.3 | Write `INTENTION_CONTRACT.md` and this tracker | — | both files present and cross-linked | **done** |
| T0.4 | Correct stale sprint-000 rows (000-12, 000-13) and the governance rows in `IMPLEMENTATION_STATUS.md` | C5.2 | board shows `done` with the merged PR numbers | **done** |
| T0.5 | File `B-20260911-01` — ownership hook does not gate `Write`/`Edit`, and has no `src/modules/**` entry | C5.5 | blocker present, owner PLATFORM-GUARDIAN | **done** |
| T0.6 | File `B-20260911-02` — ledger `organization_id` has no FK until AUTH-TENANCY lands | C3.4 | blocker present, owner AUTH-TENANCY, exit criterion recorded | **done** |
| T0.7 | File `B-20260911-03` — `main` is 11 commits behind `develop` and is the default branch | C5.5 | blocker present, owner repository owner | **done** |
| T0.8 | Open PR `chore/intention-contract-sprint-001 → develop`, pass all five checks | C6.2, C6.4 | PR checks green; PR number recorded here | `todo` |

---

## Phase 1 — Minimum toolchain

Branch: `agent/04-ledger-core-sprint-001` · Role: PLATFORM-GUARDIAN scope,
narrowed to exactly what the ledger needs. **No Next.js, no React** (C2).

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T1.1 | `package.json` + pinned `packageManager`, scripts: `typecheck`, `lint`, `test`, `test:db`, `db:migrate`, `db:reset` | C1 | `pnpm run` lists all scripts; lockfile committed | `todo` |
| T1.2 | `tsconfig.json` with `"strict": true` | C1, ADR-0001 §1 | `pnpm typecheck` exits 0 | `todo` |
| T1.3 | Vitest config with a real-Postgres integration project, no SQLite anywhere | C7.3 | `pnpm test` runs and connects to `afaq_test` | `todo` |
| T1.4 | Prisma installed, `prisma/schema.prisma` created with the Postgres datasource | C1 | `pnpm prisma validate` exits 0 | `todo` |
| T1.5 | `.env.example` with placeholder `DATABASE_URL` only — no real credential anywhere in the diff | C7.5 | `gitleaks` job green; `.env` is gitignored | `todo` |
| T1.6 | Replace `governance-checks.yml` job set with typecheck + lint + test **in addition to** the existing governance jobs, keeping the five required check names intact | C6.2 | CI green; required contexts still resolve | `todo` |

> **Constraint on T1.6:** the five required status-check *names* are
> pinned in the active rulesets. Renaming a job silently un-enforces
> the gate. Add jobs; do not rename the existing five.

---

## Phase 2 — Ledger schema and database-level invariants

Branch: `agent/04-ledger-core-sprint-001` · Role: LEDGER-CORE

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T2.1 | Models `Account`, `Period`, `PeriodLock`, `JournalEntry`, `JournalLine`, `AccountingConfig`, `JournalCounter`, `AuditLog` | C1 | `pnpm prisma validate`; migration applies to a fresh `afaq_test` | `todo` |
| T2.2 | Every ledger table: `organization_id uuid NOT NULL`, no default, no FK (owner-directed) | C3.1 | introspection asserts `NOT NULL` + type `uuid` on all 8 tables | `todo` |
| T2.3 | Every composite unique/index leads with `organization_id` | C3.2 | introspection asserts leading column on each index | `todo` |
| T2.4 | Amounts as `Decimal(18,4)` → `numeric(18,4)` | C4.8 | introspection asserts the column type; 4-dp round-trip test | `todo` |
| T2.5 | `CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))` on `JournalLine` | C4.2 | raw-SQL insert violating it is rejected | `todo` |
| T2.6 | `DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting `SUM(debit) = SUM(credit)` per entry, evaluated at `COMMIT` | C4.1 | raw-SQL unbalanced entry fails at `COMMIT`, not at `INSERT` | `todo` |
| T2.7 | Trigger rejecting `UPDATE`/`DELETE` where `posted_at IS NOT NULL`, on both `JournalEntry` and `JournalLine` | C4.3 | raw-SQL `UPDATE` and `DELETE` both raise | `todo` |
| T2.8 | `UNIQUE (organization_id, period_id, journal_number)` | C4.6 | duplicate insert rejected | `todo` |
| T2.9 | `CHECK` that a line's account and its entry share `organization_id` — the substitute for the missing FK | C3.3 | cross-org line insert is rejected by the database | `todo` |
| T2.10 | `EXCLUDE` constraint preventing overlapping periods per organization | C1 | overlapping period insert rejected | `todo` |
| T2.11 | `AuditLog` is append-only (trigger rejects `UPDATE`/`DELETE`) | C4.7 | raw-SQL mutation raises | `todo` |

> Raw SQL for triggers, `CHECK`s and `EXCLUDE` goes in the migration
> file directly — Prisma's schema language cannot express them. Each
> must be tested **through raw SQL**, not through Prisma, or the test
> proves only that the service layer behaves (C4.1's whole point).

---

## Phase 3 — Shared transaction helper

Branch: `agent/04-ledger-core-sprint-001` · Path: `src/server/tx/`

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T3.1 | `withTx(fn, { isolation, maxAttempts })` wrapping `$transaction` at `Serializable` | C4.10 | unit test over the happy path | `todo` |
| T3.2 | Bounded retry on `40001` and `40P01`, exponential backoff with jitter, default 3 attempts | C4.10 | induced serialization failure succeeds on retry; attempt count asserted | `todo` |
| T3.3 | Retries are exhausted, then the error propagates — never swallowed | C5.3 | test asserts the final throw after `maxAttempts` | `todo` |
| T3.4 | No direct `prisma.$transaction` call anywhere under `src/modules/ledger/**` | C4.10 | `grep -rn '\$transaction' src/modules/ledger/` returns nothing; asserted in CI | `todo` |

---

## Phase 4 — Ledger services

Branch: `agent/04-ledger-core-sprint-001` · Path: `src/modules/ledger/`

Every service takes a resolved `scope` (`{ userId, organizationId }`) as
its first argument and filters on `scope.organizationId`. No service
accepts an organization id from caller-supplied data (C3.1, and
`security-tenancy.md`).

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T4.1 | `createAccount`, `listAccounts` — org-scoped chart of accounts | C1 | integration test incl. a cross-org read returning empty | `todo` |
| T4.2 | `openPeriod`, `closePeriod`, `assertPeriodOpen` | C4.5 | posting into `closed` raises | `todo` |
| T4.3 | `lockPeriod`, `unlockPeriod` — both audited, both permission-gated | C4.5, C4.7 | lock → post fails → unlock → post succeeds → relock, audited end to end | `todo` |
| T4.4 | `postJournalEntry` — validates balance, allocates number via `JournalCounter` `SELECT … FOR UPDATE`, sets `posted_at`/`posted_by`, writes audit, all inside one `withTx` | C4.1, C4.6, C4.7 | balanced entry posts; unbalanced raises before commit | `todo` |
| T4.5 | `reverseJournalEntry` — posts the line-by-line inverse, links both directions, audited | C4.4 | original + reversal sum to zero per account | `todo` |
| T4.6 | Multi-currency: store transaction amount, currency, FX rate, source, timestamp and reporting amount | C4.9 | mismatched reporting amount rejected | `todo` |
| T4.7 | Unimplemented paths raise an explicit error — never a silent default | C5.3 | review + test over each declared-but-unimplemented entry point | `todo` |

---

## Phase 5 — Tests against real PostgreSQL

Branch: `agent/04-ledger-core-sprint-001` · Path: `tests/`

Every test in this phase runs against `afaq_test` on PostgreSQL 14.24.
A test that passes against SQLite proves nothing about C4.1-C4.3 (C7.3).

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T5.1 | Balance enforced at the database level, bypassing the service | C4.1 | raw-SQL unbalanced entry fails at `COMMIT` | `todo` |
| T5.2 | Debit/credit exclusivity and non-negativity | C4.2 | raw-SQL violations rejected | `todo` |
| T5.3 | Posted rows immutable — `UPDATE` and `DELETE` both rejected | C4.3 | raw-SQL, both statements, both tables | `todo` |
| T5.4 | Reversal correctness and linkage | C4.4 | inverse sums to zero; both link ids set | `todo` |
| T5.5 | Period `open`/`closed`/`locked` posting behaviour | C4.5 | all three states asserted | `todo` |
| T5.6 | Concurrent posting: two transactions, same period, distinct sequential numbers, no gaps | C4.6 | real concurrent transactions, not simulated | `todo` |
| T5.7 | Audit rows written for post, reverse, lock, unlock | C4.7 | actor, org, action, entity asserted on each | `todo` |
| T5.8 | Decimal precision round-trip at 4 dp | C4.8 | value in = value out, no float drift | `todo` |
| T5.9 | Multi-currency reporting-amount consistency | C4.9 | mismatch rejected | `todo` |
| T5.10 | Cross-org isolation within the ledger — org A cannot read or write org B's entries | C3.3 | list, read-by-id and write all asserted | `todo` |
| T5.11 | Serialization-failure retry succeeds; exhaustion throws | C4.10 | induced `40001` | `todo` |

---

## Phase 6 — Close-out

| ID | Task | Clause | Verification | Status |
|----|------|--------|--------------|--------|
| T6.1 | Paste every test command and its real output into `SPRINT_BOARD.md` | C5.2 | output present, counts match the table above | `todo` |
| T6.2 | Update `IMPLEMENTATION_STATUS.md` truthfully, naming the C3 FK limitation on every ledger row | C6.5, C3.4 | rows updated; limitation named, not omitted | `todo` |
| T6.3 | Review the diff against `no-mocks-no-stubs.md` and against the Sophia-authored-code check | C7.4 | review recorded | `todo` |
| T6.4 | Confirm no `C2` exclusion was violated — no UI, no auth, no invoices | C2 | `git diff --stat` reviewed against the C2 list | `todo` |
| T6.5 | Open PR `agent/04-ledger-core-sprint-001 → develop`; all five required checks green | C6.2 | PR number + check results recorded | `todo` |

---

## Progress

| Phase | Done | Total |
|-------|------|-------|
| 0 — Governance corrections | 7 | 8 |
| 1 — Toolchain | 0 | 6 |
| 2 — Schema + DB invariants | 0 | 11 |
| 3 — Transaction helper | 0 | 4 |
| 4 — Services | 0 | 7 |
| 5 — Tests | 0 | 11 |
| 6 — Close-out | 0 | 5 |
| **Total** | **7** | **52** |

Update this table whenever a row changes status. A percentage here that
disagrees with the rows above is itself a C5.2 violation.

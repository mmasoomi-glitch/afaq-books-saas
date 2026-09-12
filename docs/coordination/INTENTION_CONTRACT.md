# docs/coordination/INTENTION_CONTRACT.md

The binding statement of **what we intend to build, what we bind
ourselves not to do, and how each clause is verified**. It sits
between `PROJECT_BRIEF.md` (why) and `SPRINT_BOARD.md` (when).

`CLAUDE.md` and `.claude/rules/` state the rules. This file states the
**commitments** — each one with a named verification that a human or CI
can run to prove adherence or disprove a claim.

Adherence is tracked item-by-item in
[`TODO_SPRINT_001_LEDGER.md`](TODO_SPRINT_001_LEDGER.md). Every todo
item cites the contract clause it satisfies.

- **Version:** 1
- **Status:** Active
- **Opened:** 2026-09-11
- **Scope:** sprint 001, ledger-first slice
- **Signatories:** repository owner (`mmasoomi-glitch`), Lead
  Orchestrator session, every agent session that reads `CLAUDE.md`

---

## Part 0 — What is true today

This part is the audit baseline. It is factual and dated; do not
soften it.

Verified 2026-09-11 against the repository, the GitHub API and the
Sophia pod:

| Claim | Evidence |
|-------|----------|
| Zero application code exists | `git ls-files` → 40 files, all governance/docs/CI. No `package.json`, `src/`, `prisma/`, `tests/`. |
| `develop` carries all governance work | `origin/develop` @ `438bb59`, `governance-checks` green `2026-05-28T09:19Z` |
| `main` is still the empty root commit | `origin/main` @ `3a91656`, 11 commits behind `develop`; it is the repo's default branch |
| Branch protection is now configured | rulesets `protect-develop` (id 22882053) and `protect-main` (id 22882054), both `enforcement: active` — see `INTEGRATION_LOG.md` 2026-09-11 |
| The ownership hook does not gate `Write`/`Edit` | `.claude/settings.json` registers both hooks under `"matcher": "Bash"` only |
| The ownership hook does not know about `src/modules/**` | `check-agent-ownership.sh:44-58` — `protected_globs` has no `src/` entry |
| Real PostgreSQL is available for invariant tests | Sophia pod cluster `14/main` online, `PostgreSQL 14.24`, databases `nagdengi_dev` + `nagdengi_test` reachable over TCP as role `nagdengi` |

Every application row in `IMPLEMENTATION_STATUS.md` reading
`not started` is accurate as of this date.

---

## Part 1 — Intention

### C1. What we are building in this contract's scope

A **working double-entry ledger** for Nagdengi: chart of
accounts, accounting periods, journal entries and lines, posting,
reversal, and period locking — persisted in PostgreSQL, with the
accounting invariants enforced **at the database level**, covered by
tests that run against a real PostgreSQL instance.

Plus the **minimum toolchain** required to build and test that ledger:
TypeScript, Prisma, Vitest, package scripts, and a `.env.example`.

### C2. What we are explicitly NOT building in this scope

Naming these prevents scope drift and prevents a later reader from
mistaking absence for failure:

- No Next.js application, no React, no UI, no routes, no pages.
- No Auth.js wiring, no sign-in, no session handling.
- No invoices, bills, bank import, reconciliation, documents or AI.
- No reports (trial balance, P&L, balance sheet).
- No deployment, hosting decision or production database.

Each of these remains `not started` in `IMPLEMENTATION_STATUS.md` and
that is the truthful state.

### C3. The ordering decision, and its cost

The repository's documented integration order (`OWNERSHIP.md`) is
platform → architect → **auth-tenancy** → ledger. The repository owner
directed **ledger first** on 2026-09-11.

The owner further directed that ledger tables carry `organization_id`
as a **plain UUID column with no foreign key**, rather than importing a
stub `Organization` model from AUTH-TENANCY's schema section.

**The cost of that choice, stated plainly:**

Accounting invariant **I7** ("every financial row carries an
`organization_id`" and every access filters by it) will be enforced in
this scope at the **column and service layer only**. There is no
database-level referential guarantee that a given `organization_id`
names a real organization until AUTH-TENANCY lands. A typo'd or
fabricated UUID will be accepted by the database.

**The commitments that follow from accepting that cost:**

- **C3.1** — Every ledger table carries a `NOT NULL` `organization_id`
  of type `uuid`. No nullable, no default, no "global" rows.
- **C3.2** — Every composite uniqueness constraint and every index that
  matters leads with `organization_id`.
- **C3.3** — A database `CHECK` constraint asserts that a journal
  entry and every one of its lines' accounts share the same
  `organization_id`, so cross-tenant *mixing within the ledger* is
  impossible even without the FK.
- **C3.4** — The FK gap is recorded as an open blocker
  (`B-20260911-02`) and as a schema proposal to AUTH-TENANCY, and is
  listed as a known limitation in `IMPLEMENTATION_STATUS.md`. It is
  never described as done.
- **C3.5** — A follow-up migration adding the real foreign keys is a
  **required** exit criterion of the AUTH-TENANCY sprint, not an
  optional cleanup.

### C4. The invariants this scope binds itself to

Restated from `.claude/rules/accounting-integrity.md` as testable
commitments. Each names the test that proves it.

| # | Commitment | Proven by |
|---|-----------|-----------|
| C4.1 | A posted journal satisfies `Σ debits = Σ credits`, enforced by a deferred constraint trigger — not only by service code | test: posting an unbalanced entry fails at `COMMIT` even when inserted via raw SQL that bypasses the service |
| C4.2 | A journal line is either a debit or a credit, never both, never negative | test: raw-SQL insert of `debit>0 AND credit>0` is rejected by `CHECK` |
| C4.3 | A posted entry and its lines cannot be `UPDATE`d or `DELETE`d | test: raw-SQL `UPDATE`/`DELETE` on a posted row raises, via trigger |
| C4.4 | Correction happens by reversal, which posts the line-by-line inverse and links both directions | test: `reverseJournalEntry` produces an inverse whose sum is zero against the original, with `reversal_of_id`/`reversed_by_id` set |
| C4.5 | Posting into a `closed` or `locked` period fails server-side | test: `postJournalEntry` into each state raises; the failure is not a UI-only gate |
| C4.6 | Journal numbers are allocated from a counter table under `SELECT … FOR UPDATE`, never `MAX()+1` | test: two concurrent postings in the same period produce two distinct sequential numbers, zero gaps, zero collisions |
| C4.7 | Every post, reverse, lock and unlock writes an append-only audit row naming actor, organization, timestamp, action and entity | test: each service call is followed by an assertion on the audit table |
| C4.8 | Amounts are fixed-precision decimal, never JavaScript `number`, in storage | test: schema introspection asserts `numeric(18,4)`; a value with 4 decimal places round-trips without loss |
| C4.9 | Multi-currency entries record transaction currency, FX rate, and reporting amount; a reporting amount inconsistent with `amount × fx_rate` is rejected | test: an entry with a mismatched reporting amount fails |
| C4.10 | Serialization failures (`40001`) and deadlocks (`40P01`) are retried by one shared bounded-retry helper, not inline at call sites | test: an induced serialization failure succeeds on retry; `grep` asserts no direct `$transaction` call inside `src/modules/ledger/**` |

### C5. Truthfulness commitments

- **C5.1** — No service in this scope returns success without a
  committed database write in the same transaction.
- **C5.2** — No test is reported as passing without its actual output
  pasted into `SPRINT_BOARD.md`. "I think it passes" is a contract
  violation, not a rounding error.
- **C5.3** — Unimplemented behaviour raises an explicit error. It does
  not no-op, does not return a default, does not log-and-continue.
- **C5.4** — Seed data, if any, lives only under `prisma/seed/` and is
  obviously synthetic. It is never reachable from a non-seed code path.
- **C5.5** — If a contract clause cannot be met, the work stops and a
  blocker is filed. The clause is never quietly weakened to make the
  sprint look complete.

### C6. Process commitments

- **C6.1** — All work branches from `origin/develop`. Ledger work lives
  on `agent/04-ledger-core-sprint-001`.
- **C6.2** — Nothing reaches `develop` except through a pull request
  that passes the five required status checks. This is now enforced
  server-side by the `protect-develop` ruleset, not only by local hooks.
- **C6.3** — No force push, no `--no-verify`, no bypass of a required
  check, under any time pressure.
- **C6.4** — Commits are Conventional Commits, one concern each.
- **C6.5** — `IMPLEMENTATION_STATUS.md` moves a row to
  `working + tested` only when the tests proving the relevant `C4`
  clauses have actually run green, with output cited.

### C7. Where the work happens (Sophia)

Development is accelerated by the Sophia MCP pod, under these limits:

- **C7.1** — The pod is a **build and test environment**, not a source
  of truth. `/workspace/repos/nagdengi` is a clone; the
  authoritative repository is GitHub.
- **C7.2** — Code authored on the pod returns to the local governed
  checkout as a patch, and is committed and pushed from there, so every
  commit passes through this repository's hooks and identity. The pod
  never pushes to GitHub.
- **C7.3** — Tests that prove `C4` clauses run against the pod's real
  PostgreSQL 14.24 cluster. SQLite is not acceptable for invariant
  tests — its constraint and isolation semantics differ from Postgres.
- **C7.4** — Sophia-authored code is reviewed before it lands. A model
  writing a ledger is subject to the same "no mocks, no stubs" rule as
  a human, and the review specifically checks for invented behaviour.
- **C7.5** — No secret, credential, customer record or production value
  is ever sent to the pod. The pod's database password is a local
  development placeholder that appears only in `.env.example`.

---

## Part 2 — Adherence

### How a clause is checked

Each clause above is either:

- **Mechanically verified** — a test, a CI job, or a shell command
  named in the "Proven by" column; or
- **Reviewed** — a human or review pass reads the diff against the
  clause.

The todo list (`TODO_SPRINT_001_LEDGER.md`) carries one row per unit of
work, each citing its clause. A todo item may be checked off **only**
when its clause's verification has actually been run and its output
recorded.

### Definition of done for this contract's scope

All of the following, simultaneously:

1. Every `C4` clause has a passing test, with output cited in
   `SPRINT_BOARD.md`.
2. `IMPLEMENTATION_STATUS.md` rows for Chart of accounts, Accounting
   periods, Journals + posting, Reversal, Period lock and Audit log are
   updated to their **truthful** state, with the `C3` FK limitation
   named explicitly.
3. Open blockers are filed for everything deferred, each with an owner.
4. The pull request into `develop` passes all five required checks.
5. No clause in `C2` has been violated — no UI, no auth, no invoices
   crept in.

### Amending this contract

This file is versioned, not edited in place for substantive changes.
To change a commitment: increment **Version**, add an entry to the
amendment log below stating what changed and why, and record the
amendment in `INTEGRATION_LOG.md`. Silent relaxation of a clause is the
specific failure this document exists to prevent.

### Amendment log

| Version | Date | Change | Reason |
|---------|------|--------|--------|
| 1 | 2026-09-11 | Contract opened | Owner requested a full audit, an intention contract, and tracked adherence |

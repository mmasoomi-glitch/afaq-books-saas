# docs/IMPLEMENTATION_STATUS.md

Truthful, current state of what is actually implemented, persisted,
authorized and tested in this repository. Updated by every agent at
the end of every work session.

If a module is not in this table, it does not exist. If a row is
marked `not started`, it does not exist. "Not started" is the truth;
do not soften it.

---

## State — last verified 2026-09-11 (after sprint 001 merged to develop)

Re-verified against the working tree and CI. **113 tests pass against a real
`postgres:14` container** in `ledger-ci.yml` on every pull request.

`develop` @ `5f29213`. PRs #3, #4 and #5 merged 2026-09-11 on owner
authorization. `main` @ `3a91656` is still the empty root commit and is still
the public default branch — see `B-20260911-03`.

| Layer / module | State | Owner | Notes |
|----------------|-------|-------|-------|
| Repository | working | Lead | `develop` @ `5f29213`. `main` unchanged and still default — `B-20260911-03` |
| Governance docs | working | ARCHITECT | `CLAUDE.md`, 6 rule files, coordination docs, ADR-0001, `INTENTION_CONTRACT.md` v1, `CONTEXT_LEDGER.md` |
| Branch protection | working + verified | repo owner / Lead | Rulesets `protect-develop` (22882053) + `protect-main` (22882054), active, verified via the resolved-rules endpoint |
| Claude hooks | working + tested | PLATFORM-GUARDIAN | `B-20260911-01` **closed**. `check-agent-ownership.sh` now gates `Write`/`Edit`/`NotebookEdit`/`MultiEdit` as well as Bash, knows `src/modules/**`, resolves longest-prefix, matches owners by exact token. 35 local cases + 8 CI cases |
| CI | working + tested | PLATFORM-GUARDIAN | `governance-checks.yml` (5 pinned job names) + `ledger-ci.yml` (real Postgres, migration-drift check with its own shadow DB, typecheck, 113 tests, and a grep asserting each named DB invariant still exists in SQL) |
| Package manager / lockfile | working | PLATFORM-GUARDIAN | pnpm 9.15.4 pinned via `packageManager`, lockfile committed |
| TypeScript config | working | PLATFORM-GUARDIAN | strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| Test framework | working + tested | PLATFORM-GUARDIAN | Vitest, `fileParallelism: false` (one shared database). Playwright still deferred with the UI |
| Application framework (Next.js) | not started | PLATFORM-GUARDIAN | Deliberately excluded from sprint 001 by contract clause C2 |
| Lint / format config | not started | PLATFORM-GUARDIAN | no ESLint or Prettier yet |
| Database / Prisma | working + tested | LEDGER-CORE | 2 migrations, 14 models, `prisma migrate diff` reports no drift in CI |
| Chart of accounts | working + tested | LEDGER-CORE | `createAccount`, `listAccounts`, `getAccount`, org-scoped; `getAccount` returns null for another tenant's id rather than a distinguishable error |
| Accounting periods | working + tested | LEDGER-CORE | create / close / lock / unlock, each writing a `period_locks` row and an audit row in the same transaction |
| Journals + posting | working + tested | LEDGER-CORE | `postJournalEntry` in one Serializable transaction: validates, allocates the journal number via `SELECT … FOR UPDATE`, writes draft then lines then posts by UPDATE, writes audit. Concurrency tested |
| Reversal | working + tested | LEDGER-CORE | line-by-line inverse, both link directions set, audited. The link is written with raw SQL because Prisma's `@updatedAt` would break the immutability trigger's exception |
| Period lock | working + tested | LEDGER-CORE | enforced in the database (`je_period_open`) as well as the service |
| Audit log | working + tested | LEDGER-CORE | append-only table with a trigger; written on post, reverse, lock, unlock, close, account and period creation. **Security events not yet wired** — that arrives with Auth.js |
| Transaction helper | working + tested | LEDGER-CORE | `withTx` at Serializable with bounded retry on SQLSTATE 40001/40P01/55P03 only; rethrows everything else and after exhausting attempts |
| Organizations / memberships | working + tested | AUTH-TENANCY | `B-20260911-02` **closed** — all 8 ledger tables now have a real FK to `organizations(id)` `ON DELETE RESTRICT` |
| Roles / permissions | working + tested | AUTH-TENANCY | per-organization roles; permissions checked by action key, hierarchy VIEWER < BOOKKEEPER < APPROVER < ACCOUNTANT < ADMIN < OWNER |
| Authorization layer | working + tested | AUTH-TENANCY | `resolveOrgScope(userId, slug)` + `assertCanDo`. Both failure modes share a message so the error cannot confirm another tenant's slug. **Enforced** via `src/modules/ledger/guarded.ts` and `src/modules/reports/guarded.ts` — but see `B-20260911-05` |
| Authentication (Auth.js v5) | **not started** | AUTH-TENANCY | Schema exists (`users`, `sessions`, `auth_accounts`, `verification_tokens`). **Nothing derives a scope from an authenticated request yet**, so the gate is only as trustworthy as its caller |
| Trial balance | working + tested | REPORTING-ANALYTICS | posted rows only, summed in SQL, refuses to return an unbalanced result |
| Profit and loss | working + tested | REPORTING-ANALYTICS | income credit-balance, expense debit-balance, inclusive date range, inverted range throws |
| Balance sheet | working + tested | REPORTING-ANALYTICS | cumulative to a date; income and expense roll into retained earnings; the identity assets = liabilities + equity + retained earnings is enforced at exact Decimal equality with no tolerance |
| GL drilldown | not started | REPORTING-ANALYTICS | next reporting slice |
| Row Level Security | **not started** | ARCHITECT | `B-20260911-04`. Tenant isolation currently rests on application-level filtering plus the `jl_org_consistency` trigger. Judged an acceptable deferral, not an acceptable permanent state |
| Customers / Invoices / Customer payments / AR aging | not started | SALES-AR | sprint 002+ |
| Suppliers / Bills / Supplier payments / AP aging | not started | PROCUREMENT-AP | sprint 002+ |
| Bank accounts / CSV import / Reconciliation | not started | BANKING-RECON | sprint 002+ |
| Document storage / AI suggestions / AI provider | not started | DOCUMENTS-AI-SAFETY | excluded from sprint 001 by clause C2 |
| App shell / UI primitives / empty states | not started | FRONTEND-UX | excluded from sprint 001 by clause C2 |
| Accessibility audit | not started | FRONTEND-UX + QA-AUDITOR | sprint 002+ |
| Cash forecasting | not started | REPORTING-ANALYTICS | post-MVP |
| Migration readiness | not started | TBD | post-MVP |
| Multi-entity expansion | not started | TBD | post-MVP |

### What "working + tested" does not mean here

There is no user-facing application. Every row above is a server-side module
with integration tests. Nothing is deployed, nothing is reachable over HTTP, and
no human has ever posted a journal entry through a screen.

## How to update this file

When you finish work on a module:

1. Find your row.
2. Update **State**: `not started` → `in progress` → `working +
   tested` → `production-ready` (when QA-AUDITOR confirms).
3. Update **Notes** with: the relevant migration id(s), the test
   command + count, the truthful capability boundary (e.g. "posts a
   journal with one debit and one credit per line; multi-currency
   not yet supported").

Do **not**:

- Mark a row `production-ready` to make a sprint look complete.
- Claim functionality the UI suggests but the server doesn't enforce.
- List features that are wired in nav but return 501.

If a feature is half-done, the truthful state is `in progress` with a
note describing exactly what works and what doesn't. That is more
valuable than a checkmark.

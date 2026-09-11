# docs/IMPLEMENTATION_STATUS.md

Truthful, current state of what is actually implemented, persisted,
authorized and tested in this repository. Updated by every agent at
the end of every work session.

If a module is not in this table, it does not exist. If a row is
marked `not started`, it does not exist. "Not started" is the truth;
do not soften it.

---

## State — last verified 2026-09-11

Every row below was re-verified against the working tree, the GitHub
API and CI history on 2026-09-11. **No application code exists yet**:
`git ls-files` returns 40 files, all governance, documentation and CI.
There is no `package.json`, no `src/`, no `prisma/`, no `tests/`.

| Layer / module | State | Owner | Notes |
|----------------|-------|-------|-------|
| Repository | bootstrapped | Lead | `develop` @ `438bb59` carries all governance work. `main` @ `3a91656` is **still the empty root commit**, 11 commits behind, and is the public default branch — see `BLOCKERS.md` `B-20260911-03` |
| Governance docs | working | ARCHITECT | `CLAUDE.md`, 6 `.claude/rules/*.md`, `docs/coordination/*`, ADR-0001, 13 agent-prompt files — merged to `develop` via PR #1/#2 |
| Intention contract | working | Lead | `INTENTION_CONTRACT.md` v1 + `TODO_SPRINT_001_LEDGER.md` (52 tracked items, 7 done) |
| Bootstrap CI (`governance-checks.yml`) | working + tested | PLATFORM-GUARDIAN | 5 jobs; last run on `develop` `2026-05-28T09:19Z` → `success`. These five job names are now required contexts in both rulesets — renaming one silently un-enforces it |
| Claude hooks | **in progress — partially effective** | PLATFORM-GUARDIAN | `block-dangerous-git.sh` works for Bash. `check-agent-ownership.sh` is **largely unenforced**: `.claude/settings.json` registers both hooks under `"matcher": "Bash"` only, so `Write`/`Edit` calls are never checked, and `src/modules/**` is absent from its path map. See `B-20260911-01`. Do not rely on it for module-boundary enforcement |
| Branch protection | working + verified | repo owner / Lead | Rulesets `protect-develop` (22882053) + `protect-main` (22882054), `enforcement: active`. Both enforce: PR required, 5 status checks, strict up-to-date, no force push, no deletion, no bypass actors. Verified via `gh api .../rules/branches/{develop,main}` — output in `INTEGRATION_LOG.md` 2026-09-11. `B-20260527-01` resolved |
| Build/test environment | working | Lead | Sophia MCP pod: PostgreSQL 14.24 cluster online, databases `afaq_dev` + `afaq_test` reachable as role `afaq`; Node 22.20, npm 10.9, corepack 0.34. No Docker daemon — Postgres runs natively via `pg_ctlcluster`. Contract C7 governs its use |
| Application framework (Next.js) | not started | PLATFORM-GUARDIAN | **Deferred out of sprint 001** by contract clause C2 — the ledger slice needs no UI. Scaffolded in a later sprint |
| Package manager / lockfile | not started | PLATFORM-GUARDIAN | sprint 001 |
| TypeScript config | not started | PLATFORM-GUARDIAN | sprint 001 |
| Lint / format config | not started | PLATFORM-GUARDIAN | sprint 001 |
| Test framework | not started | PLATFORM-GUARDIAN | Sprint 001 — **Vitest only**; Playwright deferred with the UI (C2). Invariant tests must run against real PostgreSQL, never SQLite (C7.3) |
| CI pipeline (full) | not started | PLATFORM-GUARDIAN | Sprint 001 — typecheck + lint + test jobs **added to** `governance-checks.yml`. The 5 existing job names must not be renamed: they are required contexts in both rulesets |
| Database / Prisma | not started | LEDGER-CORE + AUTH-TENANCY | Sprint 001 — narrowed scaffold (Prisma + Postgres datasource only, no Next.js). TODO phase 1 |
| Authentication (Auth.js v5) | not started | AUTH-TENANCY | **Re-ordered after the ledger slice** by owner direction 2026-09-11. Its first task on landing is the FK migration in `B-20260911-02` |
| Authorization layer | not started | AUTH-TENANCY | **Re-ordered after the ledger slice** by owner direction 2026-09-11. Its first task on landing is the FK migration in `B-20260911-02` |
| Organizations / memberships | not started | AUTH-TENANCY | **Re-ordered after the ledger slice** by owner direction 2026-09-11. Its first task on landing is the FK migration in `B-20260911-02` |
| Roles / permissions | not started | AUTH-TENANCY | **Re-ordered after the ledger slice** by owner direction 2026-09-11. Its first task on landing is the FK migration in `B-20260911-02` |
| Chart of accounts | not started | LEDGER-CORE | Sprint 001 active — governed by `INTENTION_CONTRACT.md` v1. **Known limitation (C3 / `B-20260911-02`): `organization_id` is a plain `uuid NOT NULL` with no foreign key** until AUTH-TENANCY lands, so invariant I7 holds at the column + service layer only. |
| Accounting periods | not started | LEDGER-CORE | Sprint 001 active — governed by `INTENTION_CONTRACT.md` v1. **Known limitation (C3 / `B-20260911-02`): `organization_id` is a plain `uuid NOT NULL` with no foreign key** until AUTH-TENANCY lands, so invariant I7 holds at the column + service layer only. |
| Journals + posting | not started | LEDGER-CORE | Sprint 001 active — governed by `INTENTION_CONTRACT.md` v1. **Known limitation (C3 / `B-20260911-02`): `organization_id` is a plain `uuid NOT NULL` with no foreign key** until AUTH-TENANCY lands, so invariant I7 holds at the column + service layer only. |
| Reversal | not started | LEDGER-CORE | Sprint 001 active — governed by `INTENTION_CONTRACT.md` v1. **Known limitation (C3 / `B-20260911-02`): `organization_id` is a plain `uuid NOT NULL` with no foreign key** until AUTH-TENANCY lands, so invariant I7 holds at the column + service layer only. |
| Period lock | not started | LEDGER-CORE | Sprint 001 active — governed by `INTENTION_CONTRACT.md` v1. **Known limitation (C3 / `B-20260911-02`): `organization_id` is a plain `uuid NOT NULL` with no foreign key** until AUTH-TENANCY lands, so invariant I7 holds at the column + service layer only. |
| Customers | not started | SALES-AR | sprint 002+ |
| Invoices | not started | SALES-AR | sprint 002+ |
| Customer payments | not started | SALES-AR | sprint 002+ |
| AR aging | not started | SALES-AR | sprint 002+ |
| Suppliers | not started | PROCUREMENT-AP | sprint 002+ |
| Bills | not started | PROCUREMENT-AP | sprint 002+ |
| Supplier payments | not started | PROCUREMENT-AP | sprint 002+ |
| AP aging | not started | PROCUREMENT-AP | sprint 002+ |
| Bank accounts | not started | BANKING-RECON | sprint 002+ |
| CSV statement import | not started | BANKING-RECON | sprint 002+ |
| Reconciliation | not started | BANKING-RECON | sprint 002+ |
| Document storage abstraction | not started | DOCUMENTS-AI-SAFETY | **Deferred out of sprint 001** by contract clause C2 (ledger-first). Re-planned in a later sprint |
| AI suggestion model | not started | DOCUMENTS-AI-SAFETY | **Deferred out of sprint 001** by contract clause C2 (ledger-first). Re-planned in a later sprint |
| AI provider integration | not started | DOCUMENTS-AI-SAFETY | TBD; no provider until grounding/anti-injection tests exist |
| Audit log | not started | LEDGER-CORE + AUTH-TENANCY | Sprint 001 — append-only `AuditLog` table + writer for ledger actions only (post, reverse, lock, unlock). Security events wired when AUTH-TENANCY lands |
| Trial balance | not started | REPORTING-ANALYTICS | sprint 002+ |
| Profit and loss | not started | REPORTING-ANALYTICS | sprint 002+ |
| Balance sheet | not started | REPORTING-ANALYTICS | sprint 002+ |
| GL drilldown | not started | REPORTING-ANALYTICS | sprint 002+ |
| Cash forecasting | not started | REPORTING-ANALYTICS | post-MVP |
| App shell / navigation | not started | FRONTEND-UX | **Deferred out of sprint 001** by contract clause C2 (ledger-first). Re-planned in a later sprint |
| Shared UI primitives | not started | FRONTEND-UX | **Deferred out of sprint 001** by contract clause C2 (ledger-first). Re-planned in a later sprint |
| Empty / loading / error states | not started | FRONTEND-UX | **Deferred out of sprint 001** by contract clause C2 (ledger-first). Re-planned in a later sprint |
| Accessibility audit | not started | FRONTEND-UX + QA-AUDITOR | sprint 002+ |
| Migration readiness (import from other systems) | not started | TBD | post-MVP |
| Multi-entity expansion | not started | TBD | post-MVP, depends on org model maturity |

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

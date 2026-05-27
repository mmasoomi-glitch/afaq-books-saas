# docs/IMPLEMENTATION_STATUS.md

Truthful, current state of what is actually implemented, persisted,
authorized and tested in this repository. Updated by every agent at
the end of every work session.

If a module is not in this table, it does not exist. If a row is
marked `not started`, it does not exist. "Not started" is the truth;
do not soften it.

---

## Bootstrap state — 2026-05-27

| Layer / module | State | Owner | Notes |
|----------------|-------|-------|-------|
| Repository | bootstrapped | Lead | `main` + `develop` exist at SHA `3a91656`; governance bootstrap branch open |
| Governance docs | in progress | Lead → ARCHITECT (after merge) | `CLAUDE.md`, `.claude/rules/`, `docs/coordination/`, ADR-0001 written on `chore/agent-governance-bootstrap` |
| Claude hooks | in progress | Lead → PLATFORM-GUARDIAN (after merge) | `block-dangerous-git.sh` + `check-agent-ownership.sh` written and unit-tested; settings.json wires them |
| Branch protection | **not configured** | repo owner | see `BLOCKERS.md` `B-20260527-01` |
| Application framework (Next.js) | not started | PLATFORM-GUARDIAN | sprint 001 |
| Package manager / lockfile | not started | PLATFORM-GUARDIAN | sprint 001 |
| TypeScript config | not started | PLATFORM-GUARDIAN | sprint 001 |
| Lint / format config | not started | PLATFORM-GUARDIAN | sprint 001 |
| Test framework | not started | PLATFORM-GUARDIAN | sprint 001 (Vitest + Playwright) |
| CI pipeline (full) | not started | PLATFORM-GUARDIAN | sprint 001; only `governance-checks.yml` runs in sprint 000 |
| Database / Prisma | not started | LEDGER-CORE + AUTH-TENANCY | sprint 001 |
| Authentication (Auth.js v5) | not started | AUTH-TENANCY | sprint 001 |
| Authorization layer | not started | AUTH-TENANCY | sprint 001 |
| Organizations / memberships | not started | AUTH-TENANCY | sprint 001 |
| Roles / permissions | not started | AUTH-TENANCY | sprint 001 |
| Chart of accounts | not started | LEDGER-CORE | sprint 001 |
| Accounting periods | not started | LEDGER-CORE | sprint 001 |
| Journals + posting | not started | LEDGER-CORE | sprint 001 |
| Reversal | not started | LEDGER-CORE | sprint 001 |
| Period lock | not started | LEDGER-CORE | sprint 001 |
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
| Document storage abstraction | not started | DOCUMENTS-AI-SAFETY | sprint 001 (schema only) |
| AI suggestion model | not started | DOCUMENTS-AI-SAFETY | sprint 001 (schema only) |
| AI provider integration | not started | DOCUMENTS-AI-SAFETY | TBD; no provider until grounding/anti-injection tests exist |
| Audit log | not started | LEDGER-CORE + AUTH-TENANCY | sprint 001 (schema), sprint 002 (writer wired across modules) |
| Trial balance | not started | REPORTING-ANALYTICS | sprint 002+ |
| Profit and loss | not started | REPORTING-ANALYTICS | sprint 002+ |
| Balance sheet | not started | REPORTING-ANALYTICS | sprint 002+ |
| GL drilldown | not started | REPORTING-ANALYTICS | sprint 002+ |
| Cash forecasting | not started | REPORTING-ANALYTICS | post-MVP |
| App shell / navigation | not started | FRONTEND-UX | sprint 001 |
| Shared UI primitives | not started | FRONTEND-UX | sprint 001 |
| Empty / loading / error states | not started | FRONTEND-UX | sprint 001 |
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

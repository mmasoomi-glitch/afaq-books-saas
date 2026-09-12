# docs/coordination/PROJECT_BRIEF.md

## Mission

Build **Nagdengi** into a production-grade, multi-tenant,
double-entry accounting platform that an accountant would trust with
real books.

This is **not** a visual prototype, **not** a fake-data demo, and
**not** a dashboard mockup exercise. Everything that ships is
persistent, authorized, audited and tested.

## What "production-grade" means here

- Real database persistence (PostgreSQL via Prisma).
- Real authentication (Auth.js v5) and **separate** server-side
  authorization with per-organization roles.
- Real double-entry ledger with database-enforced invariants.
- Real audit trails on every material financial action.
- Real provider abstractions (no fake "payment success" / "bank
  connected" toasts; truthful not-configured / failed states instead).
- Real tests covering happy paths, tenant isolation, accounting
  invariants and AI grounding.

## Stack (see ADR-0001)

| Layer            | Choice                                          |
|------------------|-------------------------------------------------|
| Framework        | Next.js 15 (App Router) + React Server Components |
| Language         | TypeScript, strict mode                         |
| Database         | PostgreSQL                                      |
| ORM / migrations | Prisma                                          |
| Auth (identity)  | Auth.js v5 (App-Router-compatible line)         |
| Authorization    | Custom server-side role/permission layer        |
| Tests            | Vitest (unit), Playwright (e2e) — to be wired   |
| Style            | Tailwind + accessible primitives — to be wired  |
| Package manager  | pnpm (preferred) — to be confirmed by PLATFORM-GUARDIAN |

Versions will be pinned by PLATFORM-GUARDIAN when the application is
scaffolded in a follow-up sprint. The bootstrap sprint commits only
governance.

## Modules (planned)

1. `auth` — identity, sessions, organizations, memberships, roles.
2. `ledger` — chart of accounts, periods, journals, posting, reversal.
3. `sales` — customers, invoices, payments, AR aging.
4. `procurement` — suppliers, bills, payments, AP aging.
5. `banking` — bank accounts, statement import, reconciliation.
6. `documents` — attachment storage abstraction, document metadata.
7. `ai` — suggestion records, grounding, anti-hallucination guardrails.
8. `reports` — trial balance, P&L, balance sheet, GL drilldown.
9. `ui` — shared shell, navigation, primitives, truthful empty states.
10. `audit` — append-only audit log.
11. `config` — accounting config, tax setup, FX rates.

Exact paths will be confirmed by ARCHITECT in `OWNERSHIP.md`.

## Operating model — twelve agents

See `OWNERSHIP.md` for the full role-to-paths map.

| # | Agent | Responsibility |
|---|-------|----------------|
| 1 | ARCHITECT | Repo inspection, module boundaries, ADRs, dependency map |
| 2 | PLATFORM-GUARDIAN | Tooling, CI/CD, hooks, environment validation |
| 3 | AUTH-TENANCY | Auth.js wiring, orgs, memberships, roles, server-side authorization |
| 4 | LEDGER-CORE | CoA, periods, journals, posting, reversals, period locks |
| 5 | SALES-AR | Customers, invoices, payments, AR aging |
| 6 | PROCUREMENT-AP | Suppliers, bills, supplier payments, AP aging |
| 7 | BANKING-RECON | Bank accounts, statement import, reconciliation |
| 8 | DOCUMENTS-AI-SAFETY | Document storage abstraction, AI suggestions, grounding |
| 9 | REPORTING-ANALYTICS | TB, P&L, BS, GL, report ↔ ledger validation |
| 10 | FRONTEND-UX | Shell, navigation, shared primitives, truthful states |
| 11 | QA-AUDITOR | Test strategy, invariants, isolation, mock/stub scans |
| 12 | GITKEEPER-INTEGRATOR | Sprint integration, conflict resolution, PR sequencing |

Plus a **Lead Orchestrator** session (the user-facing Claude) that
sequences work, runs governance, reviews escalations.

## How sessions are isolated

This Claude Code installation cannot guarantee that twelve concurrent
agent-team teammates each run inside their own worktree without
clobbering shared files. The mandated fallback is therefore:

- **Lead session** (this one): coordinates, edits governance and
  coordination docs, reviews.
- **Twelve worker sessions**: launched manually by the user, each as
  a separate `claude` CLI process pointed at its own worktree on its
  own `agent/NN-<role>-sprint-N` branch.
- The per-agent launch prompts live under
  `docs/coordination/agent-prompts/` and include the worktree path
  the user is expected to `cd` into before launching.

This preserves true isolation (no two Claude sessions share a
filesystem checkout) at the cost of requiring the human to start
multiple terminals. It is the only safe way given current tooling.

## Sprint cadence

- **Sprint 000 (this bootstrap)** — governance only. No application
  code. Outputs: `CLAUDE.md`, `.claude/`, `docs/coordination/`,
  `docs/IMPLEMENTATION_STATUS.md`, `.github/`, agent prompts.
- **Sprint 001** — application scaffold:
  - PLATFORM-GUARDIAN: install Next.js 15 + TS + Prisma + Auth.js v5,
    set up package scripts, wire CI to run real lint/typecheck/test.
  - ARCHITECT: ADR-0002 module layout, ADR-0003 transaction strategy.
  - AUTH-TENANCY: organization + membership + role schema (first
    real ledger-adjacent migration).
- **Sprint 002+** — module verticals built end-to-end, one slice at
  a time. No "broad half-built screens." Specific contents decided
  per sprint based on completed groundwork.

## Out of scope for sprint 000

- Any business logic.
- Any database schema beyond what's needed to scaffold (none).
- Any UI beyond a README.
- Any third-party provider integration.
- Any AI integration.
- Setting `develop`/`main` branch protection via API — **proposed**
  in `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, awaiting human approval
  to apply.

## Why we are not creating a `pre-commit-quality-gate.sh` yet

The hook would need to run typecheck, lint and tests. None of those
exist in the repo yet — there is no `package.json`, no installed
toolchain, and no source code to check. A hook that runs commands
which don't exist either no-ops silently (giving false reassurance)
or fails every commit (blocking work). PLATFORM-GUARDIAN will add the
real hook in the application-scaffold sprint, once the commands are
real and have been verified.

## Why CI is minimal in this sprint

For the same reason: with no application code, a CI workflow that
runs `pnpm install && pnpm test` would fail on a missing
`package.json`. The bootstrap CI does what it actually can verify
right now: markdown sanity, YAML sanity, `bash -n` parse-check on the
hook scripts, and a secret scan. PLATFORM-GUARDIAN replaces it with
the full pipeline in the scaffold sprint.

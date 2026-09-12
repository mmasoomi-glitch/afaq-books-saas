# docs/coordination/OWNERSHIP.md

The single source of truth for **who edits what** during the twelve-agent
sprint workflow. The Claude hooks (`block-dangerous-git.sh` and
`check-agent-ownership.sh`) reference this table.

> **Read rule:** any agent may *read* any file.
> **Write rule:** any agent may *write* only its assigned paths,
> except via a documented handoff in `BLOCKERS.md` approved by the
> path owner and recorded by GITKEEPER-INTEGRATOR.

---

## Discovered repository layout (as of sprint 000)

The repository was empty before this sprint. As of the governance
bootstrap merge, the layout is:

```
.
├── README.md
├── CLAUDE.md
├── .gitignore
├── .gitattributes
├── .claude/
│   ├── settings.json
│   ├── hooks/
│   │   ├── block-dangerous-git.sh
│   │   ├── check-agent-ownership.sh
│   │   └── README.md
│   └── rules/
│       ├── git-collaboration.md
│       ├── accounting-integrity.md
│       ├── security-tenancy.md
│       ├── no-mocks-no-stubs.md
│       ├── ai-hallucination-memory.md
│       └── testing-release-gates.md
├── docs/
│   ├── IMPLEMENTATION_STATUS.md
│   └── coordination/
│       ├── PROJECT_BRIEF.md
│       ├── ARCHITECTURE_DECISIONS.md
│       ├── adr/0001-stack-nextjs15-prisma-postgres-authjs.md
│       ├── OWNERSHIP.md                       (this file)
│       ├── SPRINT_BOARD.md
│       ├── BLOCKERS.md
│       ├── INTEGRATION_LOG.md
│       ├── GITHUB_BRANCH_PROTECTION_REQUIRED.md
│       ├── schema-proposals/README.md
│       └── agent-prompts/01..12-*.md
└── .github/
    ├── PULL_REQUEST_TEMPLATE.md
    ├── CONTRIBUTING.md
    └── workflows/governance-checks.yml
```

No application code exists yet. The `src/` tree and the Next.js
scaffolding will be created in sprint 001 by PLATFORM-GUARDIAN +
ARCHITECT under controlled paths defined below.

---

## Planned application layout (sprint 001+)

Paths below are **proposed**. ARCHITECT confirms or revises them in
ADR-0002 before sprint 001 worker branches start.

```
src/
├── app/                          # Next.js App Router root
│   ├── (marketing)/              # public pages
│   ├── (auth)/                   # sign-in, sign-up
│   ├── (app)/[orgSlug]/          # authenticated org-scoped UI
│   ├── api/                      # route handlers (where unavoidable)
│   └── layout.tsx
├── server/
│   ├── auth/                     # Auth.js v5 + custom authz layer
│   ├── db/                       # Prisma client factory + helpers
│   ├── audit/                    # audit-log writer
│   ├── ai/                       # AI provider abstraction + grounding
│   ├── docs/                     # document storage abstraction
│   └── tx/                       # shared $transaction helper with retry
├── modules/
│   ├── ledger/                   # CoA, periods, journals, posting
│   ├── sales/                    # customers, invoices, AR
│   ├── procurement/              # suppliers, bills, AP
│   ├── banking/                  # bank accounts, reconciliation
│   ├── reports/                  # TB, P&L, BS, GL
│   └── config/                   # accounting config, FX, tax setup
├── ui/                           # shared primitives (FRONTEND-UX)
└── lib/                          # generic helpers (TBD owner per file)
prisma/
├── schema.prisma                 # single source of truth schema
├── migrations/                   # ordered migration history
└── seed/                         # explicitly-labelled seed data
tests/
├── unit/
├── integration/
├── e2e/
└── fixtures/
```

---

## Ownership table

| # | Role | Slug (for `NAQDENGI_AGENT`) | Owned paths (write) | Notes |
|---|------|-------------------------|---------------------|-------|
| 1 | **ARCHITECT** | `architect` | `docs/coordination/adr/**`, `docs/coordination/ARCHITECTURE_DECISIONS.md`, contributes proposals (read-write) to `docs/coordination/OWNERSHIP.md` and `CLAUDE.md` | May read everything. Architecture changes that move ownership lines require a co-signed update to this file with GITKEEPER. |
| 2 | **PLATFORM-GUARDIAN** | `platform-guardian` | `.claude/**`, `.github/**`, `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `next.config.*`, `eslint.config.*`, `vitest.config.*`, `playwright.config.*`, `prettier.config.*`, `docker-compose*.yml`, `Dockerfile*`, `.env.example`, `.env.test.example` | Sole owner of `.claude/settings.json` and hooks once bootstrap is merged. Owns the global lint/typecheck/test commands. |
| 3 | **AUTH-TENANCY** | `auth-tenancy` | `src/server/auth/**`, `src/app/(auth)/**`, `src/modules/*/auth/**` (cross-module auth glue), schema sections for `User`, `Organization`, `Membership`, `Role`, `Permission`, `Session`, `Account` in `prisma/schema.prisma` and the corresponding migrations | Schema co-owner with LEDGER-CORE. Authorization helpers consumed everywhere; treat the public API as a contract. |
| 4 | **LEDGER-CORE** | `ledger-core` | `src/modules/ledger/**`, `src/server/tx/**`, schema sections for `Account`, `JournalEntry`, `JournalLine`, `Period`, `PeriodLock`, `AccountingConfig` in `prisma/schema.prisma` and corresponding migrations | Primary schema owner for ledger tables. Any migration that touches a ledger table requires LEDGER-CORE review even if authored by another agent. |
| 5 | **SALES-AR** | `sales-ar` | `src/modules/sales/**`, schema sections for `Customer`, `Invoice`, `InvoiceLine`, `CustomerPayment`, `PaymentAllocation`, `CreditNote` in `prisma/schema.prisma` and corresponding migrations | Posts via LEDGER-CORE service interfaces. Files migrations as proposals to LEDGER-CORE schema for receivable accounts. |
| 6 | **PROCUREMENT-AP** | `procurement-ap` | `src/modules/procurement/**`, schema sections for `Supplier`, `Bill`, `BillLine`, `SupplierPayment`, `BillApproval` in `prisma/schema.prisma` and corresponding migrations | Posts via LEDGER-CORE service interfaces. |
| 7 | **BANKING-RECON** | `banking-recon` | `src/modules/banking/**`, schema sections for `BankAccount`, `BankStatement`, `BankTransaction`, `Reconciliation`, `ReconciliationMatch` in `prisma/schema.prisma` and corresponding migrations | CSV import + duplicate detection + matching. No "fake matched" toggles. |
| 8 | **DOCUMENTS-AI-SAFETY** | `documents-ai-safety` | `src/server/docs/**`, `src/server/ai/**`, `src/modules/*/ai/**`, schema sections for `Document`, `DocumentMetadata`, `AISuggestion`, `AIGrounding`, `AISuggestionEvent` in `prisma/schema.prisma` and corresponding migrations | Owns provider abstractions for storage and AI. Anti-hallucination tests are required for every AI surface. |
| 9 | **REPORTING-ANALYTICS** | `reporting-analytics` | `src/modules/reports/**`, schema sections for any read-model / materialized aggregate tables (each must be provably derivable from the ledger) | Read-mostly. May not bypass LEDGER-CORE invariants. |
| 10 | **FRONTEND-UX** | `frontend-ux` | `src/ui/**`, `src/app/(marketing)/**`, `src/app/(app)/[orgSlug]/_components/**`, `src/app/layout.tsx`, `tailwind.config.*` | Owns shared primitives and the app shell. Does **not** own feature pages (those belong to the owning module agent, which composes from `src/ui/`). |
| 11 | **QA-AUDITOR** | `qa-auditor` | `tests/**` for cross-cutting suites (auth invariants, accounting invariants, no-stub scans, security scans). Per-module unit tests live under each module and are owned by the module agent. | Issues findings; does **not** rewrite feature code. Findings go to the module owner via `BLOCKERS.md`. |
| 12 | **GITKEEPER-INTEGRATOR** | `gitkeeper-integrator` | `integration/sprint-*` branch only. May write to `docs/coordination/INTEGRATION_LOG.md`, `docs/coordination/SPRINT_BOARD.md` (status column), and resolve conflicts during integration with documented merges into any path. May edit branch-protection configuration only on user authorization. | Reviews — does **not** casually rewrite feature code. Conflict resolutions are documented in `INTEGRATION_LOG.md`. |

---

## Protected shared paths (require declared owner)

Even within a feature module, these files require coordination:

| Path | Sole owner |
|------|-----------|
| `CLAUDE.md` | ARCHITECT (+ GITKEEPER for integration text) |
| `.claude/settings.json` | PLATFORM-GUARDIAN |
| `.claude/hooks/**` | PLATFORM-GUARDIAN |
| `.claude/rules/**` | ARCHITECT (rule authoring), PLATFORM-GUARDIAN (testing-release-gates) |
| `docs/coordination/OWNERSHIP.md` (this file) | ARCHITECT + GITKEEPER co-sign |
| `docs/coordination/SPRINT_BOARD.md` | every agent edits its own row; GITKEEPER owns sprint metadata |
| `docs/coordination/BLOCKERS.md` | every agent appends; GITKEEPER curates |
| `docs/coordination/INTEGRATION_LOG.md` | GITKEEPER only |
| `docs/IMPLEMENTATION_STATUS.md` | every agent edits its own module row |
| `prisma/schema.prisma` | LEDGER-CORE + AUTH-TENANCY (their sections); other agents propose via `docs/coordination/schema-proposals/` |
| `prisma/migrations/**` | the schema owner who authored the corresponding model change |
| `package.json`, lockfiles | PLATFORM-GUARDIAN |
| `next.config.*`, `tsconfig.json` | PLATFORM-GUARDIAN |
| `.github/workflows/**` | PLATFORM-GUARDIAN (+ GITKEEPER for release workflows) |
| `.env.example` | PLATFORM-GUARDIAN |

---

## Handoff procedure

If you need to change a file you don't own:

1. **Stop.** Do not edit it.
2. Open an entry under `BLOCKERS.md` titled `handoff: <agent> → <owner>: <path>`.
3. Describe the exact change needed and why.
4. Tag the owning agent.
5. If GITKEEPER and the owner agree, the owner makes the change on
   the owner's branch, OR GITKEEPER grants you a temporary handoff
   that is recorded in `INTEGRATION_LOG.md`.
6. You do not start editing until the handoff entry is marked
   `granted` by GITKEEPER.

---

## Schema-change coordination

Non-schema-owner agents do **not** edit `prisma/schema.prisma` or
`prisma/migrations/**` directly. Instead they file a proposal:

```
docs/coordination/schema-proposals/NNNN-<short-slug>.md
```

The proposal includes: tables/columns needed, FKs, indexes,
constraints, expected query patterns, why existing schema is
insufficient. The relevant schema owner reviews, then either:

- writes the migration on their branch and tags the proposer, or
- replies with a counter-proposal in the same file.

GITKEEPER sequences migrations so two agents do not author conflicting
changes to the same table.

---

## Integration ordering

Default per-sprint order (GITKEEPER may revise per sprint based on
blockers):

1. PLATFORM-GUARDIAN (tooling enables others)
2. ARCHITECT (ADRs lock contracts)
3. AUTH-TENANCY (auth/orgs are a prerequisite for everything else)
4. LEDGER-CORE (financial primitives needed by sales/procurement/banking)
5. SALES-AR / PROCUREMENT-AP / BANKING-RECON (parallel, integrated after LEDGER-CORE)
6. DOCUMENTS-AI-SAFETY (depends on at least one bookable entity to attach to)
7. REPORTING-ANALYTICS (reads from a populated ledger)
8. FRONTEND-UX (shared primitives integrated early, but feature shells integrated alongside their feature)
9. QA-AUDITOR (findings against the integrated branch)
10. GITKEEPER (final integration PR into `develop`)

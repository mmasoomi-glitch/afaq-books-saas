# docs/coordination/SPRINT_BOARD.md

## Active sprint

**Sprint 000 — Governance bootstrap.**

- **Sprint base SHA**: `3a91656329828d9bb97b567036ff9a6a1692462c`
- **Sprint base ref**: `origin/develop` (immediately after `chore: initial commit (empty repo bootstrap)`)
- **Bootstrap branch**: `chore/agent-governance-bootstrap`
- **Integration branch (planned)**: not used in sprint 000 — bootstrap PR goes directly from `chore/agent-governance-bootstrap` into `develop` because no feature branches run in parallel during this sprint.
- **Start date**: 2026-05-27
- **Target end**: when this PR merges into `develop`

## Tasks in sprint 000

| # | Owner | Task | Status | Branch | Evidence |
|---|-------|------|--------|--------|----------|
| 000-1 | Lead | Initialize repo: create `main` and `develop` from empty remote | done | `main`, `develop` | `git rev-parse origin/develop` → `3a91656...` |
| 000-2 | Lead | Inspect existing GitHub branch protection | done | n/a | `gh api .../rulesets` → `[]`; `gh api .../branches/{main,develop}/protection` → 404 (no protection set) |
| 000-3 | Lead | Create `chore/agent-governance-bootstrap` from `origin/develop` | done | `chore/agent-governance-bootstrap` | branch tracked, HEAD at sprint base SHA |
| 000-4 | Lead | Write `CLAUDE.md` | done | `chore/agent-governance-bootstrap` | file present |
| 000-5 | Lead | Write `.claude/rules/*.md` (6 files) | done | `chore/agent-governance-bootstrap` | 6 files present |
| 000-6 | Lead | Write `.claude/settings.json` + 2 hook scripts + hook README | done | `chore/agent-governance-bootstrap` | hooks parse-check OK, 7 functional tests pass for `block-dangerous-git.sh`, 4 for `check-agent-ownership.sh` |
| 000-7 | Lead | Write `docs/coordination/*` including ADR-0001 | done | `chore/agent-governance-bootstrap` | files present |
| 000-8 | Lead | Write `docs/IMPLEMENTATION_STATUS.md` | done | `chore/agent-governance-bootstrap` | file present |
| 000-9 | Lead | Write `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `workflows/governance-checks.yml` | done | `chore/agent-governance-bootstrap` | files present |
| 000-10 | Lead | Write 12 per-agent prompt files under `docs/coordination/agent-prompts/` | done | `chore/agent-governance-bootstrap` | 12 files |
| 000-11 | Lead | Write `.gitignore` and `.gitattributes` for Next.js/TS/Prisma stack | done | `chore/agent-governance-bootstrap` | files present |
| 000-12 | Lead | Commit + push `chore/agent-governance-bootstrap` (no PR opened yet) | in progress | `chore/agent-governance-bootstrap` | — |
| 000-13 | Lead | Prepare PR plan, present to user for approval before opening | pending | n/a | — |

> When this sprint closes (merge into `develop`), the final integration
> note moves to `INTEGRATION_LOG.md`.

---

## Sprint 001 — planned (NOT started)

**Sprint base SHA**: TBD (the SHA of `origin/develop` after the
sprint-000 bootstrap PR merges).

| # | Owner | Task |
|---|-------|------|
| 001-1 | PLATFORM-GUARDIAN | Scaffold Next.js 15 + TypeScript + Tailwind + ESLint + Prettier + Vitest + Playwright + Prisma; pin versions in `package.json`; commit lockfile; replace governance-checks CI with the real pipeline; add `pre-commit-quality-gate.sh` now that commands exist |
| 001-2 | ARCHITECT | ADR-0002 module layout; ADR-0003 transaction-helper + retry strategy; update `OWNERSHIP.md` if scaffold revealed better paths |
| 001-3 | AUTH-TENANCY | First real migration: `User`, `Organization`, `Membership`, `Role`, `Permission`, `Session`, `Account` tables; Auth.js v5 wiring; `resolveOrgScope` + `assertCanDo` helpers; tenant-isolation test harness |
| 001-4 | DOCUMENTS-AI-SAFETY | Schema for `Document`, `AISuggestion`, `AIGrounding`; storage abstraction (local-fs adapter for dev, S3-compatible adapter stub returning 503 until configured); no AI provider wired this sprint |
| 001-5 | LEDGER-CORE | Schema for `Account`, `JournalEntry`, `JournalLine`, `Period`, `PeriodLock`, `AccountingConfig` with DB-level invariants; `postJournal`, `reverseJournal`, `lockPeriod` service helpers; bounded-retry transaction helper |
| 001-6 | QA-AUDITOR | Tenant-isolation test harness, accounting-invariant test harness, no-stub scan integrated into CI |
| 001-7 | FRONTEND-UX | Auth shell (`(auth)`), org-scoped layout (`(app)/[orgSlug]`), navigation primitives, truthful empty/loading/error states; sign-in page wired to Auth.js v5 |
| 001-8 | GITKEEPER | Create `integration/sprint-001` from `origin/develop`; orchestrate the per-agent worker branches; integrate in the order defined in `OWNERSHIP.md` |

> SALES-AR, PROCUREMENT-AP, BANKING-RECON, REPORTING-ANALYTICS do
> **not** start in sprint 001 — their dependencies (ledger primitives,
> auth, orgs) must be real first. They join in sprint 002+.

---

## Reporting cadence

Every agent updates its row(s) at the end of every work session, even
mid-sprint. The "Evidence" column must contain a command + result, a
test count, a CI link, or a file path — never just "done."

GITKEEPER reviews the board at start and end of each sprint and moves
finished sprint sections into `INTEGRATION_LOG.md` once the sprint PR
merges into `develop`.

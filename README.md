# Afaq Books SaaS

Production-grade, multi-tenant, double-entry accounting platform.

**Status: bootstrap.** No application code has been merged yet. Governance, ownership and architecture decisions are being established first.

## Branches

- `main` — production-quality stable branch. Never push directly.
- `develop` — approved integration branch. Never push directly.
- `chore/*`, `feat/*`, `fix/*`, `agent/*-sprint-N` — work branches; always branched from `origin/develop`.
- `integration/sprint-N` — GitKeeper integration branches.

## Where to start

After `chore/agent-governance-bootstrap` is merged into `develop`, read in order:

1. `CLAUDE.md`
2. `.claude/rules/`
3. `docs/coordination/PROJECT_BRIEF.md`
4. `docs/coordination/OWNERSHIP.md`
5. `docs/coordination/SPRINT_BOARD.md`
6. `docs/IMPLEMENTATION_STATUS.md`

## Stack (planned, see ADR-0001)

Next.js 15 (App Router) · TypeScript (strict) · Prisma · PostgreSQL · Auth.js v5.

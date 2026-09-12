# Contributing to Naqdengi

This file is the short version. The binding rules are in:

- `CLAUDE.md` (root) — non-negotiable rules.
- `.claude/rules/` — detail per concern (git, accounting, security, AI, tests).
- `docs/coordination/OWNERSHIP.md` — who owns what.
- `docs/coordination/SPRINT_BOARD.md` — current sprint base SHA + tasks.

## Branch model

```
main                   — production; protected, never push directly
develop                — approved integration; protected, never push directly
integration/sprint-NNN — GitKeeper-owned per-sprint integration branch
agent/NN-<role>-sprint-NNN — per-agent feature branch
chore/* feat/* fix/*  — generic work branches
```

Every work branch starts from **`origin/develop`** at the recorded
sprint base SHA.

```bash
git fetch origin --prune
git switch -c agent/04-ledger-core-sprint-001 origin/develop
```

## Forbidden

- Pushing to `main` or `develop`.
- `--no-verify`.
- `--force`, `--force-with-lease`, `-f`.
- Direct commits while checked out on `main` or `develop`.
- Editing paths you don't own without a documented handoff
  (`BLOCKERS.md`).
- Fake data in production paths, fake success toasts, in-memory
  arrays-as-database, fake AI output, fake provider success.

The Claude hooks `block-dangerous-git.sh` and
`check-agent-ownership.sh` enforce most of the above locally. GitHub
branch protection enforces the Git ones server-side (see
`docs/coordination/GITHUB_BRANCH_PROTECTION_REQUIRED.md`).

## Commit messages

Conventional Commits:

```
<type>(<scope>): <subject>

<body explaining WHY, wrapped at 72>

<footer if needed>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `security`,
`perf`, `build`, `ci`. Scopes mirror module names where possible
(`ledger`, `auth`, `ar`, `ap`, `banking`, `reports`, `docs-ai`, `ui`,
`qa`, `ci`, `governance`).

## Pull requests

- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`).
- Paste actual command output for `typecheck`, `lint`, `test`,
  `test:e2e`, `build`, `prisma migrate`. Don't paraphrase.
- Tick the security/accounting/AI checkboxes truthfully.
- Worker branches go through QA-AUDITOR → GITKEEPER-INTEGRATOR →
  `integration/sprint-N`. GITKEEPER opens the single `integration/sprint-N
  → develop` PR.

## Local dev (once sprint 001 lands)

Until sprint 001 lands, this repo has no application code. After
sprint 001:

```bash
pnpm install
cp .env.example .env
# fill in DATABASE_URL, AUTH_SECRET, etc.
pnpm prisma migrate dev
pnpm dev
```

Exact commands will be pinned in `package.json` and reflected in
`.claude/rules/testing-release-gates.md` by PLATFORM-GUARDIAN.

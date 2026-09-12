# docs/coordination/agent-prompts/

These twelve files are the launch prompts for the twelve specialist
agents. Each one is **self-contained**: paste it into a fresh
`claude` session running in the agent's own worktree, and the agent
has everything it needs to start.

## How to launch a worker

For each agent (example: LEDGER-CORE, sprint 001):

### Bash (Linux / macOS / Git Bash on Windows)

```bash
cd /path/to/nagdengi
git fetch origin --prune

# 1. Create the worktree on a fresh branch from origin/develop
git worktree add -b agent/04-ledger-core-sprint-001 \
  ../nagdengi--04-ledger-core origin/develop

# 2. Enter it
cd ../nagdengi--04-ledger-core

# 3. Identify the agent for the ownership hook
export NAGDENGI_AGENT=ledger-core

# 4. Launch a Claude session in this worktree
claude
```

Then paste the contents of `04-ledger-core.md` as the first message.

### PowerShell (Windows)

```powershell
cd C:\Users\Magic\Desktop\nagdengi
git fetch origin --prune

# 1. Create the worktree on a fresh branch from origin/develop
git worktree add -b agent/04-ledger-core-sprint-001 `
  ..\nagdengi--04-ledger-core origin/develop

# 2. Enter it
cd ..\nagdengi--04-ledger-core

# 3. Identify the agent for the ownership hook
$env:NAGDENGI_AGENT = "ledger-core"

# 4. Launch a Claude session in this worktree
claude
```

## Worker → branch mapping

| # | Agent | Slug (NAGDENGI_AGENT) | Worktree dir (sibling of repo) | Branch (sprint 001 example) |
|---|-------|--------------------|---------------------------------|------------------------------|
| 1 | ARCHITECT | `architect` | `nagdengi--01-architect` | `agent/01-architect-sprint-001` |
| 2 | PLATFORM-GUARDIAN | `platform-guardian` | `nagdengi--02-platform-guardian` | `agent/02-platform-guardian-sprint-001` |
| 3 | AUTH-TENANCY | `auth-tenancy` | `nagdengi--03-auth-tenancy` | `agent/03-auth-tenancy-sprint-001` |
| 4 | LEDGER-CORE | `ledger-core` | `nagdengi--04-ledger-core` | `agent/04-ledger-core-sprint-001` |
| 5 | SALES-AR | `sales-ar` | `nagdengi--05-sales-ar` | `agent/05-sales-ar-sprint-001` |
| 6 | PROCUREMENT-AP | `procurement-ap` | `nagdengi--06-procurement-ap` | `agent/06-procurement-ap-sprint-001` |
| 7 | BANKING-RECON | `banking-recon` | `nagdengi--07-banking-recon` | `agent/07-banking-recon-sprint-001` |
| 8 | DOCUMENTS-AI-SAFETY | `documents-ai-safety` | `nagdengi--08-documents-ai-safety` | `agent/08-documents-ai-safety-sprint-001` |
| 9 | REPORTING-ANALYTICS | `reporting-analytics` | `nagdengi--09-reporting-analytics` | `agent/09-reporting-analytics-sprint-001` |
| 10 | FRONTEND-UX | `frontend-ux` | `nagdengi--10-frontend-ux` | `agent/10-frontend-ux-sprint-001` |
| 11 | QA-AUDITOR | `qa-auditor` | `nagdengi--11-qa-auditor` | `agent/11-qa-auditor-sprint-001` |
| 12 | GITKEEPER-INTEGRATOR | `gitkeeper-integrator` | `nagdengi--12-gitkeeper-integrator` | `agent/12-gitkeeper-integrator-sprint-001` |

## Sprint 000 status

In sprint 000, only the **lead session** wrote. All twelve worker
prompt files are committed but the workers themselves are **not
launched yet**, because there is no application code for most of them
to work on and the bootstrap PR has not been merged.

Launch order for sprint 001 (after the bootstrap PR merges into
`develop`):

1. **PLATFORM-GUARDIAN** first — scaffolds Next.js / TS / Prisma /
   Auth.js / Vitest / Playwright and replaces the CI workflow.
2. **ARCHITECT** second — ADR-0002 module layout once the scaffold
   exists; revisits `OWNERSHIP.md` if the layout shifts.
3. **AUTH-TENANCY** and **LEDGER-CORE** in parallel — schema for
   their respective sections. Migrations are sequenced by GITKEEPER.
4. **DOCUMENTS-AI-SAFETY** — schema for documents and AI suggestion
   tables; no AI provider wired yet.
5. **FRONTEND-UX** — auth shell + org-scoped layout + primitives.
6. **QA-AUDITOR** — test harnesses for tenant isolation, accounting
   invariants, and the mock/stub scanner.
7. **SALES-AR**, **PROCUREMENT-AP**, **BANKING-RECON**,
   **REPORTING-ANALYTICS** — sprint 002+, after ledger primitives
   are real.
8. **GITKEEPER-INTEGRATOR** — last, integrates everything into
   `integration/sprint-001` and opens the PR into `develop`.

## After the worker is done

When a worker finishes its sprint task, it (a) pushes its branch,
(b) updates `SPRINT_BOARD.md`, (c) updates `IMPLEMENTATION_STATUS.md`,
(d) leaves the worktree intact (do not `git worktree remove` until
GITKEEPER has confirmed integration). The user can then close that
CLI session; GITKEEPER picks up from the pushed branch.

## Cleanup after the sprint

After GITKEEPER's integration PR merges into `develop`:

```bash
cd /path/to/nagdengi
git worktree remove ../nagdengi--04-ledger-core
git branch -d agent/04-ledger-core-sprint-001  # safe delete; refuses if unmerged
```

Do **not** use `git branch -D` (force delete) — the
`block-dangerous-git.sh` hook forbids it.

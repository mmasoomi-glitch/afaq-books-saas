# docs/coordination/INTEGRATION_LOG.md

GITKEEPER-INTEGRATOR's append-only ledger of integration decisions,
conflict resolutions and sprint closes. No other agent writes here.

Entries are dated and reference the sprint and the SHA(s) involved.
Conflict resolutions must explain **what was preserved from each
branch and why** — never "I took whichever merged cleanly."

---

## Template

```markdown
## YYYY-MM-DD — <subject>

- **Sprint:** <NNN>
- **Action:** integrate | resolve-conflict | branch-cleanup | release-promote
- **Branches involved:** <list with SHAs>
- **Result:** <new SHA or branch state>

### What happened

<narrative>

### Decisions made

<bulleted list with rationale>

### Evidence

<commands run, test output, CI links>

### Follow-ups

<bulleted list, each tagged with a `BLOCKERS.md` entry or owner>
```

---

## 2026-05-27 — Sprint 000 bootstrap initialized

- **Sprint:** 000
- **Action:** branch-creation
- **Branches involved:**
  - `main` created at `3a91656329828d9bb97b567036ff9a6a1692462c` (root commit: `chore: initial commit (empty repo bootstrap)`)
  - `develop` branched from `main` at `3a91656...`
  - `chore/agent-governance-bootstrap` branched from `origin/develop` at `3a91656...`
- **Result:** sprint base SHA `3a91656329828d9bb97b567036ff9a6a1692462c` recorded in `SPRINT_BOARD.md`

### What happened

The repository was empty when work started. The lead session created
`main` with a minimal README, pushed, branched and pushed `develop`,
then branched `chore/agent-governance-bootstrap` from `origin/develop`
for the governance work. No application code was added; the bootstrap
branch contains only governance, rules, ownership, ADRs, hooks, CI
scaffolding and per-agent prompt files.

### Decisions made

- Lead session, not a worker agent, owned the bootstrap because the
  worker structure (worktrees + isolated CLI sessions) cannot exist
  until the governance defining it has been written.
- `develop` and `main` share the same first commit (a one-file README);
  this is the minimal valid bootstrap and was the user-approved
  Option 1 path.
- No `integration/sprint-000` branch exists; the sprint-000 PR will go
  directly from `chore/agent-governance-bootstrap` into `develop`
  because no parallel worker branches run during sprint 000.

### Evidence

```text
$ git rev-parse origin/develop
3a91656329828d9bb97b567036ff9a6a1692462c

$ git rev-parse --abbrev-ref HEAD
chore/agent-governance-bootstrap

$ gh api repos/mmasoomi-glitch/afaq-books-saas/rulesets
[]

$ gh api repos/.../branches/main/protection
{"message":"Branch not found","status":"404"}
$ gh api repos/.../branches/develop/protection
{"message":"Branch not found","status":"404"}
```

### Follow-ups

- See `BLOCKERS.md` `B-20260527-01` — server-side branch protection
  must be configured before sprint 001 starts.
- After the sprint-000 PR merges, GITKEEPER takes over and is the
  only role that writes here going forward.

---

## 2026-09-11 — Branch protection configured; sprint 000 closed

- **Sprint:** 000 (close) → 001 (open)
- **Action:** release-promote (policy) / sprint-close
- **Branches involved:**
  - `develop` @ `438bb59` (governance bootstrap + CI fix, checks green)
  - `main` @ `3a91656` (unchanged — still the empty root commit)
- **Result:** rulesets `protect-develop` (id 22882053) and
  `protect-main` (id 22882054) active; `B-20260527-01` resolved

> **Authorship note.** This file is GITKEEPER-only. This entry is
> written by the Lead Orchestrator session under the explicit
> instruction in `GITHUB_BRANCH_PROTECTION_REQUIRED.md` §Sequencing
> step 3 ("the lead session runs the API calls below, then records the
> confirmed configuration in `INTEGRATION_LOG.md`"), on owner
> authorization given 2026-09-11.

### What happened

The repository owner authorized applying the revised single-owner
branch-protection plan. Two rulesets were POSTed and then verified
through the **resolved-rules** endpoint rather than trusting the POST
response — per the instruction in
`GITHUB_BRANCH_PROTECTION_REQUIRED.md` §Verifying, which requires that
no document claim protection is configured until the resolved query
returns the expected shape.

Sprint 000's two pull requests (#1 bootstrap, #2 CI fix) had already
merged into `develop` on 2026-05-28, but the sprint board still showed
tasks 000-12 and 000-13 as `in progress`/`pending`. Those rows were
corrected in the same change; the stale rows were a reporting lapse,
not a work lapse.

### Decisions made

- **Rulesets, not classic branch protection.** Per-actor bypass modes
  and audit history; classic protection kept documented as fallback.
- **Zero required approving reviews.** Single-owner repository — a
  non-zero count would make every PR unmergeable, which is the trap the
  revised plan was written to avoid.
- **No bypass actors on either branch.** The emergency procedure in
  `GITHUB_BRANCH_PROTECTION_REQUIRED.md` covers genuine incidents and
  requires a log entry within 24h.
- **`strict_required_status_checks_policy: true`** on both, so a branch
  must be up to date with its base before merging.
- **`main` left untouched.** Promoting the governance bootstrap to
  `main` is a separate decision, filed as `B-20260911-03`.

### Evidence

```text
$ gh api --method POST .../rulesets --input rs-develop.json --jq '{id,name,enforcement}'
{"enforcement":"active","id":22882053,"name":"protect-develop"}

$ gh api --method POST .../rulesets --input rs-main.json --jq '{id,name,enforcement}'
{"enforcement":"active","id":22882054,"name":"protect-main"}

$ gh api .../rules/branches/develop --jq '[.[] | .type] | sort'
["deletion","non_fast_forward","pull_request","required_status_checks"]

$ gh api .../rules/branches/main --jq '[.[] | .type] | sort'
["deletion","non_fast_forward","pull_request","required_status_checks"]

$ gh api .../rules/branches/develop --jq \
    '.[] | select(.type=="required_status_checks")
         | .parameters.required_status_checks[].context'
Hook scripts parse cleanly
Hook scripts block what they should
Governance documents exist
YAML files parse
gitleaks (no secrets in diff)
```

### Follow-ups

- `B-20260911-01` — the ownership hook does not gate `Write`/`Edit`
  and has no `src/modules/**` entry. Owner: PLATFORM-GUARDIAN. This is
  the largest remaining governance gap; local enforcement of
  `OWNERSHIP.md` is close to nominal until it is fixed.
- `B-20260911-02` — ledger `organization_id` carries no foreign key
  until AUTH-TENANCY lands. Owner: AUTH-TENANCY. Must not be closed
  until the FK migration is merged.
- `B-20260911-03` — `main` is 11 commits behind `develop` and is the
  public default branch. Owner: repository owner.
- The five required status-check names are now load-bearing strings in
  both rulesets. Any change to job names in `governance-checks.yml`
  must update both rulesets in the same change, or the gate silently
  stops applying.

---

## 2026-09-11 — Sprint 001 integrated: PRs #3, #4 and #5 merged into `develop`

- **Sprint:** 001
- **Action:** integrate
- **Branches involved:**
  - `chore/intention-contract-sprint-001` → PR #3
  - `fix/ownership-hook-write-edit` → PR #4
  - `agent/04-ledger-core-sprint-001` → PR #5
- **Result:** `develop` `438bb59` → `df1ff3a` → `10de300` → `5f29213`

> **Authorization.** `CLAUDE.md` reserves merges into `develop` for an
> authorized human. The repository owner explicitly delegated these three
> merges to the lead session on 2026-09-11, in writing, after all checks were
> green. That delegation is the authorization; it is recorded here so the audit
> trail shows who permitted what rather than the merges simply appearing.

### What happened

Merged in dependency order. The rulesets use
`strict_required_status_checks_policy`, so each merge made the next branch
stale; each was synced with `gh pr update-branch` and re-run before merging.
Every branch was green on all required checks at the moment it merged — #3 and
#4 on five checks, #5 on six (the five governance checks plus
`Ledger typecheck and invariant tests`).

### Decisions made

- **Merge commits, not squash.** The branch history carries the reasoning for
  several non-obvious decisions — why the reversal link is written with raw SQL,
  why `NOT VALID` was stripped from the foreign keys, why a balance-sheet test
  was deleted rather than fixed. Squashing would have discarded it.
- **`main` left untouched.** Still the empty root commit, still the public
  default branch. Promoting `develop` to `main` is a separate decision, tracked
  as `B-20260911-03`.

### Evidence

```text
$ gh pr checks 3 | grep -c pass   -> 5
$ gh pr checks 4 | grep -c pass   -> 5
$ gh pr checks 5 | grep -c pass   -> 6
$ gh pr list --state open         -> []
$ git rev-parse --short origin/develop -> 5f29213
```

CI on PR #5, on a real `postgres:14` service container:

```text
No migration drift between schema.prisma and migrations
  No difference detected.
      Tests  113 passed (113)
```

### Verdict trail (judge: Sophia, independent of the implementer)

1. First review of the milestone returned two conditions: enable Row Level
   Security, and put the financial reports behind the authorization gate. The
   judge found the report gap independently, and raised RLS, which the
   implementer had not.
2. Condition 2 was implemented — `src/modules/reports/guarded.ts`, 7 tests — and
   re-submitted with new evidence. Verdict: *"Condition 2 is satisfied;
   application-level gating is the current architectural standard, and enforcing
   it via code review is sufficient for this stage."*
3. Condition 1 deferred with the judge's reasoning recorded in
   `B-20260911-04`: *"Deferring RLS is acceptable as the existing
   org-consistency trigger and application-level filtering provide robust
   isolation, making it a safe reversible follow-up."*

### Follow-ups

- `B-20260911-03` — `main` is behind `develop` and is the public default branch.
- `B-20260911-04` — no Row Level Security.
- `B-20260911-05` — nothing mechanically forces callers through the gate.
- No Auth.js session yet: the authorization gate is only as trustworthy as
  whatever eventually calls `resolveOrgScope`.

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

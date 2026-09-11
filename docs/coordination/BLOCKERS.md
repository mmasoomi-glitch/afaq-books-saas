# docs/coordination/BLOCKERS.md

Living list of blockers, handoffs and "I can't finish my task because…"
entries. Every agent appends here when needed. GITKEEPER curates and
resolves.

## How to file

Append a new section at the bottom using this template:

```markdown
### B-YYYYMMDD-NN — <short title>

- **Filed by:** <agent slug>
- **Date:** YYYY-MM-DD
- **Branch:** <agent branch>
- **Status:** open | acknowledged | granted | resolved | rejected
- **Type:** blocker | handoff request | schema proposal | clarification

**What I need**

<concrete description>

**Why this is needed**

<concrete description tying it to a sprint-board task>

**What I tried**

<concrete description, including commands and outputs if relevant>

**Asks**

- <agent owner>: please <action>
- GITKEEPER: please <action>
```

Numbering: `B-YYYYMMDD-NN` where NN is sequential within that date.

---

## Open

### B-20260527-01 — Branch protection on `main` and `develop` is not configured

- **Filed by:** Lead Orchestrator
- **Date:** 2026-05-27
- **Last updated:** 2026-09-11 (**resolved** — see "Resolution" at the end of this entry)
- **Branch:** `chore/agent-governance-bootstrap`
- **Status:** resolved
- **Type:** blocker (release-readiness) — but **not** a blocker on the bootstrap PR merge

**What I need**

The repository owner (already authenticated) to either:

(a) authorize me to configure protection via `gh api` using the JSON
in `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, **after** the bootstrap PR
has been manually merged to `develop`; or

(b) configure it themselves in the GitHub UI per that document, also
after the bootstrap PR has been merged.

Both must be done **before** sprint 001 worker branches are launched.

**Why this is needed**

Hooks and CLAUDE.md are *local* controls. They can be bypassed by a
user with write access or by tooling that doesn't load this repo's
Claude settings. Without server-side rulesets, the guarantee "no one
pushes directly to `develop` or `main`" is not enforceable.

**Update — single-owner correction (2026-05-27)**

The original plan in this file's `GITHUB_BRANCH_PROTECTION_REQUIRED.md`
proposed `required_approving_review_count = 2` on `main` and `= 1` on
`develop`, with `enforce_admins = true`. The user (single owner)
correctly pointed out that this would lock the repo: the same identity
that opens a PR cannot approve it. The revised plan in that document
removes required approvals entirely for the single-owner phase, keeps
"require PR + status checks + block force-push + block deletion", and
documents the upgrade path when a second trusted reviewer joins.

The revised plan also **defers** protection configuration until after
the bootstrap PR is manually merged, so the bootstrap PR itself is
not blocked by a require-PR rule it cannot satisfy (the workflow run
needs to land on `develop` first).

**What I tried**

- `gh api repos/.../rulesets` → `[]`
- `gh api repos/.../branches/main/protection` → 404
- `gh api repos/.../branches/develop/protection` → 404

No protection exists. Authenticated session (`mmasoomi-glitch`) has
`admin:true`, so the configuration calls are runnable on user
authorization.

**Asks**

- Repository owner: review the revised plan in
  `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, then either (a) authorize
  the lead session to apply rulesets via `gh api`, or (b) apply
  rulesets in the GitHub UI.
- Action must happen **after** the bootstrap PR merges and **before**
  sprint 001 starts.
- GITKEEPER: track this until resolved; do not approve the sprint 001
  integration PR until rulesets are confirmed live via API.

**Resolution — 2026-09-11**

The repository owner authorized the lead session to apply the revised
single-owner plan. Both rulesets were created and then **verified via
the resolved-rules endpoint**, not assumed from the POST response:

```text
$ gh api .../rulesets --jq '.[] | {name, enforcement, target}'
{"enforcement":"active","name":"protect-develop","target":"branch"}
{"enforcement":"active","name":"protect-main","target":"branch"}

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

Ruleset ids: `protect-develop` = 22882053, `protect-main` = 22882054.
Recorded in `INTEGRATION_LOG.md` under 2026-09-11.

**Consequence for every agent:** the five check names above are now
load-bearing. Renaming a job in `governance-checks.yml` silently
un-enforces that gate, because the ruleset matches on the name string.
Add jobs; do not rename these five without updating both rulesets in
the same change.

---

### B-20260911-01 — Ownership hook does not gate `Write`/`Edit`, and does not know about `src/modules/**`

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Branch:** `chore/intention-contract-sprint-001`
- **Status:** open
- **Type:** blocker (governance correctness)

**What I need**

PLATFORM-GUARDIAN to close three gaps in
`.claude/hooks/check-agent-ownership.sh` and `.claude/settings.json`.

**Why this is needed**

`OWNERSHIP.md` is the repository's central conflict-prevention
mechanism, and it is currently close to unenforced:

1. **`Write`/`Edit` are never checked.** `.claude/settings.json`
   registers both hooks under a single `"matcher": "Bash"`. An agent
   editing a file the normal way — with the `Write` or `Edit` tool —
   never reaches the ownership hook at all. Only shell redirections
   are inspected.
2. **`src/modules/**` is not in `protected_globs`**
   (`check-agent-ownership.sh:44-58`). Module boundaries — the whole
   point of the twelve-agent split — are not represented, so even the
   Bash path would not catch SALES-AR writing into
   `src/modules/ledger/`.
3. **Write-detection is a lowercased substring scan**
   (`check-agent-ownership.sh:84-91`). It false-positives on reads
   that merely redirect (`cat prisma/schema.prisma > /tmp/x`) and
   false-negatives on any write that does not contain one of eight
   literal markers (a Python or Node one-liner, `python -c
   "open(...,'w')"`, `install`, `truncate`).

A fourth, smaller issue: owner matching uses a substring test
(`:103`), so a future agent slug that is a prefix of another would
match the wrong row.

**What I tried**

Read both files in full and confirmed the matcher and the glob list.
The CI functional tests in `governance-checks.yml` pass — but they
only exercise the Bash path, so they do not detect gap (1) or (2).

**Asks**

- PLATFORM-GUARDIAN: add `Write|Edit|NotebookEdit` matchers reading
  `tool_input.file_path`; add `src/modules/**`, `src/server/**`,
  `src/ui/**`, `tests/**` to the ownership map; replace the substring
  write-heuristic with explicit path extraction; make owner matching
  exact-token.
- QA-AUDITOR: add CI cases covering a `Write`-tool call and a
  cross-module `src/modules/**` write, so the gaps cannot silently
  reopen.

---

### B-20260911-02 — Ledger `organization_id` has no foreign key until AUTH-TENANCY lands

- **Filed by:** Lead Orchestrator (on behalf of LEDGER-CORE)
- **Date:** 2026-09-11
- **Branch:** `agent/04-ledger-core-sprint-001`
- **Status:** open (accepted limitation, tracked to closure)
- **Type:** schema proposal / handoff request → AUTH-TENANCY

**What I need**

AUTH-TENANCY to add foreign keys from every ledger table's
`organization_id` to `Organization(id)` as part of its sprint, and to
treat that migration as a **required exit criterion**, not optional
cleanup.

**Why this is needed**

The repository owner directed a ledger-first ordering on 2026-09-11,
and directed that ledger tables carry `organization_id` as a plain
`uuid NOT NULL` column with no FK, rather than importing a stub
`Organization` model into AUTH-TENANCY's schema section.

The consequence, stated plainly: accounting invariant **I7** is
enforced at the column and service layer only. The database will
accept an `organization_id` that names no real organization. Nothing
detects an orphaned or fabricated tenant id until the FK exists.

Mitigations already committed to in `INTENTION_CONTRACT.md` C3:

- `organization_id` is `uuid NOT NULL`, no default, on all ledger
  tables (C3.1).
- Every composite unique/index leads with `organization_id` (C3.2).
- A database `CHECK` asserts a journal entry and its lines' accounts
  share the same `organization_id`, so cross-tenant *mixing within
  the ledger* is impossible even without the FK (C3.3).

These reduce the blast radius. They do not replace referential
integrity.

**Asks**

- AUTH-TENANCY: on landing `Organization`, author the migration
  adding `FOREIGN KEY (organization_id) REFERENCES "Organization"(id)`
  to `Account`, `Period`, `PeriodLock`, `JournalEntry`,
  `AccountingConfig`, `JournalCounter` and `AuditLog`, plus a
  data-integrity check for pre-existing orphans.
- LEDGER-CORE: review that migration (ledger tables, so review is
  mandatory regardless of author).
- GITKEEPER: do not close this blocker until the FKs are live in a
  merged migration.

---

### B-20260911-03 — `main` is 11 commits behind `develop` and is the repository's default branch

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Branch:** n/a
- **Status:** open
- **Type:** clarification / owner decision

**What I need**

A decision from the repository owner on whether `main` should be
brought up to date with `develop`, and whether `develop` should
become the default branch.

**Why this is needed**

`origin/main` is still at `3a91656` — the empty-repo root commit
carrying only a README. `origin/develop` is at `438bb59` with the
entire governance bootstrap. `main` is the repo's **default** branch
and the repository is **public**, so anyone who clones or browses it
sees an empty project and none of the governance that defines how
this codebase is built.

This is not itself dangerous — no false financial claim is being made
— but it misrepresents the project's state to any reader, which sits
uncomfortably next to the truthfulness rules in `CLAUDE.md`.

**What I tried**

```text
$ git rev-parse --short origin/main origin/develop
3a91656
438bb59
$ git log --oneline origin/main..origin/develop | wc -l
11
$ gh api repos/mmasoomi-glitch/afaq-books-saas --jq .default_branch
main
```

**Asks**

- Repository owner: choose one — (a) open a PR `develop → main` to
  promote the governance bootstrap, (b) switch the default branch to
  `develop` and keep `main` for released versions only, or (c)
  document deliberately that `main` stays empty until first release.
- Note that `protect-main` now requires a PR plus the five status
  checks for any change to `main`, so option (a) is a normal PR, not
  a direct push.

---

## Resolved

- **`B-20260527-01`** — branch protection on `main` and `develop`.
  Resolved 2026-09-11; rulesets `protect-develop` (22882053) and
  `protect-main` (22882054) verified active via the resolved-rules
  endpoint. The full entry is retained above with its history and
  resolution evidence.

---

## Rejected

*(none yet)*

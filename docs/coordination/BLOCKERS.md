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
- **Last updated:** 2026-05-27 (revised after user correction; see "Update" below)
- **Branch:** `chore/agent-governance-bootstrap`
- **Status:** open
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

---

## Resolved

*(none yet)*

---

## Rejected

*(none yet)*

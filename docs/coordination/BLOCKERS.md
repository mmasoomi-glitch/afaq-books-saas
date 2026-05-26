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
- **Branch:** `chore/agent-governance-bootstrap`
- **Status:** open
- **Type:** blocker (release-readiness)

**What I need**

The repository owner (already authenticated) to either:

(a) authorize me to configure protection via `gh api` using the exact
JSON proposed in `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, or

(b) configure it themselves in the GitHub UI per that document.

**Why this is needed**

Hooks and CLAUDE.md are *local* controls. They can be bypassed by a
user with write access. Without server-side branch protection, the
guarantee "no one pushes directly to `develop` or `main`" is not
enforceable. This is required before sprint 001 starts, otherwise an
honest mistake (or an agent that runs outside this Claude config) can
push to a protected branch.

**What I tried**

- `gh api repos/.../rulesets` → `[]`
- `gh api repos/.../branches/main/protection` → 404
- `gh api repos/.../branches/develop/protection` → 404

No protection exists.

**Asks**

- Repository owner: choose option (a) or (b) above.
- GITKEEPER: track this until resolved; do not approve the sprint-000
  PR merge into `develop` until protection is in place (or until the
  owner explicitly waives the requirement for this single bootstrap
  PR).

---

## Resolved

*(none yet)*

---

## Rejected

*(none yet)*

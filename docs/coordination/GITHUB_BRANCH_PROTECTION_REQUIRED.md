# docs/coordination/GITHUB_BRANCH_PROTECTION_REQUIRED.md

## Status

**CONFIGURED AND VERIFIED — 2026-09-11.**

The owner authorized the revised single-owner plan on 2026-09-11 and
the lead session applied it. Both rulesets are `enforcement: active`
and were confirmed through the resolved-rules endpoint (see
§Verifying below), not inferred from the POST response:

| Ruleset | Id | Target | Rules resolved |
|---------|----|--------|----------------|
| `protect-develop` | 22882053 | `refs/heads/develop` | `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` |
| `protect-main` | 22882054 | `refs/heads/main` | `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks` |

Full command output is recorded in `INTEGRATION_LOG.md` under
2026-09-11. Blocker `B-20260527-01` is resolved.

> **The five required check names are now load-bearing strings.**
> Both rulesets match required status checks by name. Renaming a job
> in `.github/workflows/governance-checks.yml` does not fail — it
> silently stops enforcing that gate. Add jobs freely; change these
> five only by updating both rulesets in the same change.

---

## Original status entry (historical)

**Not configured.** Verified on 2026-05-27 by the lead session:

```text
$ gh api repos/mmasoomi-glitch/naqdengi/rulesets
[]

$ gh api repos/.../branches/main/protection
{"message":"Branch not found","documentation_url":"...","status":"404"}

$ gh api repos/.../branches/develop/protection
{"message":"Branch not found","documentation_url":"...","status":"404"}
```

The 404 means *no protection rule is set* — both branches now exist
(created in sprint 000), so the endpoint is reachable; only the
configuration is missing.

The authenticated `gh` CLI session (`mmasoomi-glitch`) has
`admin:true` on this repo, so the API calls below would succeed.
The lead session does **not** run them without explicit user
authorization, because configuring branch protection is a persistent
change to the repository's policy surface.

---

## Correction — single-owner reality

An earlier draft of this document proposed
`required_approving_review_count = 2` on `main` and
`= 1` on `develop`, with `enforce_admins = true`. **Do not apply
that draft.** It locks a single-owner repository: the same
identity that opens a PR cannot approve it, and `enforce_admins =
true` removes the owner's bypass — meaning every PR (including the
sprint 000 bootstrap PR) would be unmergeable.

The revised plan below works for a single-owner public repo,
introduces no lockout, and documents the upgrade path when a
second trusted reviewer joins.

---

## Sequencing

Apply protection **after** the sprint 000 bootstrap PR
(`chore/agent-governance-bootstrap → develop`) is merged manually
by the owner. Reasons:

1. `governance-checks.yml` only lands on `develop` when the PR
   merges. Until then there is no workflow-on-develop for a status-
   check rule to require. The workflow does run on the PR itself
   (PRs evaluate workflow files from the source branch), so the
   bootstrap PR's checks are visible — but configuring a rule that
   says "every PR into develop must produce check `Governance
   documents exist`" is more reliably done after merge.
2. We want to confirm the workflow actually runs to green at least
   once before requiring it — so we can pin the *exact* check-run
   names GitHub reports (case and spacing matter).

So the order is:

1. **You** review and merge PR #1 (`chore/agent-governance-bootstrap
   → develop`) in the GitHub UI.
2. **You authorize** the lead session via `BLOCKERS.md` to apply
   protection (or you apply it yourself in the UI).
3. The lead session runs the API calls below, then records the
   confirmed configuration in `INTEGRATION_LOG.md`. Until that
   API confirmation, no doc claims protection is configured.

---

## Mechanism — prefer **GitHub Rulesets** over classic branch protection

This is a public repo on GitHub.com, so rulesets are available and
preferred. They give:

- **Per-actor bypass list with explicit modes** (`always`, `pull_request`)
  instead of the classic protection's binary `enforce_admins` toggle.
- **Audit history** of who changed which rule when.
- **Multiple rulesets per branch** if we later want different rules
  per environment (e.g. add a "release" ruleset that only applies
  during release windows).
- **Targeted refs by pattern**, so we can apply the same rule to
  `main` and `develop` from one ruleset if desired (we still use
  two — different policies).

Classic branch protection is the fallback if rulesets are
unavailable. The exact JSON for both is below.

---

## Plan for `develop` (single-owner phase)

Ruleset name: `protect-develop`.

| Rule | Setting | Rationale |
|------|---------|-----------|
| Require a pull request before merging | **on** | Forces every change through PR + CI |
| Required approving reviews | **0** (no approvals required yet) | Single owner cannot approve own PR; raise to 1 when a 2nd trusted reviewer joins |
| Dismiss stale approvals | n/a (no approvals required) | Will enable when approvals are required |
| Require status checks | **on**, contexts = the 5 `governance-checks` job names (see API call below) | Only required after confirming the workflow ran green once on the merged develop |
| Require branches to be up to date before merging | **on** | Forces rebase against latest develop before merge |
| Restrict deletions | **on** | No accidental `git push --delete` of develop |
| Block force pushes | **on** | No `--force` even with admin |
| Require linear history | **off** | Merge commits are fine for sprint integrations |
| Require signed commits | **off** | Not enforced until commit-signing is wired into agent tooling — add later, not load-bearing for safety |
| Restrict who can push | n/a (PR-only mode handles this) | Direct push blocked for everyone including admin (see bypass below) |
| Bypass actors | **none** | Owner pushes via PR. If a true emergency arises, temporarily add owner with `bypass_mode=always`, perform action, remove. Logged. |

### API call (preferred: rulesets)

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/naqdengi/rulesets \
  --input - <<'JSON'
{
  "name": "protect-develop",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/develop"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Hook scripts parse cleanly" },
          { "context": "Hook scripts block what they should" },
          { "context": "Governance documents exist" },
          { "context": "YAML files parse" },
          { "context": "gitleaks (no secrets in diff)" }
        ]
      }
    }
  ]
}
JSON
```

> `deletion` rule blocks branch deletion. `non_fast_forward` blocks
> force pushes (a force push rewrites history, which is by definition
> non-fast-forward from the prior tip).

### API call (fallback: classic branch protection)

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/naqdengi/branches/develop/protection \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]="Hook scripts parse cleanly" \
  -F required_status_checks.contexts[]="Hook scripts block what they should" \
  -F required_status_checks.contexts[]="Governance documents exist" \
  -F required_status_checks.contexts[]="YAML files parse" \
  -F required_status_checks.contexts[]="gitleaks (no secrets in diff)" \
  -F enforce_admins=false \
  -F required_pull_request_reviews.dismiss_stale_reviews=false \
  -F required_pull_request_reviews.require_code_owner_reviews=false \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true \
  -F required_linear_history=false \
  -F lock_branch=false \
  -F allow_fork_syncing=false
```

> `enforce_admins=false` here is **deliberate single-owner accommodation**:
> the owner can still merge their own PR through the GitHub UI when
> the only failing gate would be "no approving reviews" (but we have
> set required-approvals to 0, so that doesn't apply). The owner
> cannot push directly to develop — the "require PR" rule applies
> to admins as well at the GitHub-UI level for the PR-merge action.

### Transition: when a second trusted reviewer joins

Update the ruleset:

```bash
# Find the ruleset id
RID=$(gh api repos/mmasoomi-glitch/naqdengi/rulesets --jq '.[] | select(.name=="protect-develop") | .id')

# Patch only the pull_request rule
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/naqdengi/rulesets/$RID \
  -F 'rules[]=...with required_approving_review_count=1 and dismiss_stale_reviews_on_push=true'
```

(The exact patch payload is verbose; in practice we re-POST the
whole ruleset definition with the changed value. Document the new
state in `INTEGRATION_LOG.md` when applied.)

---

## Plan for `main` (single-owner phase)

Ruleset name: `protect-main`.

Same as `develop` except:

- `main` is the production branch — we use it less often, only for
  promoted releases.
- We still defer required approvals until a second reviewer exists
  (same single-owner reason).
- We do **not** add an admin-bypass actor for `main`. If a true
  production emergency requires bypass, follow the documented
  emergency procedure below — `gh api` to temporarily edit the
  ruleset, perform the action, restore the ruleset. Both edits are
  logged by GitHub and the lead session records them in
  `INTEGRATION_LOG.md`.

### API call (preferred: rulesets)

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/naqdengi/rulesets \
  --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Hook scripts parse cleanly" },
          { "context": "Hook scripts block what they should" },
          { "context": "Governance documents exist" },
          { "context": "YAML files parse" },
          { "context": "gitleaks (no secrets in diff)" }
        ]
      }
    }
  ]
}
JSON
```

### When a second trusted reviewer joins — proposed for `main`

Two options for the owner to decide between when applying the
upgrade:

**Option A — Wait for the second reviewer (recommended).**

Set `required_approving_review_count = 1` and **no bypass actor**.
Every PR into main needs the second reviewer's approval. The owner
cannot self-approve. This is the strongest stance.

**Option B — Configure emergency-owner bypass (use sparingly).**

Set `required_approving_review_count = 1` and add the owner to
`bypass_actors` with `bypass_mode = "pull_request"`. This means:

- Routine: every PR into main needs an approving review.
- Emergency: owner can merge their own PR without an approval, but
  the bypass appears in the audit log; document the reason in
  `INTEGRATION_LOG.md` within 24h.

Bypass actor JSON (when chosen):

```json
"bypass_actors": [
  {
    "actor_id": <id of the owner's user record>,
    "actor_type": "RepositoryRole",
    "bypass_mode": "pull_request"
  }
]
```

(The `actor_type` for a single user owner is `RepositoryRole` with
`actor_id` of the admin role — typically `5`. Confirm via
`gh api repos/.../collaborators` and the role list before applying.)

---

## Emergency owner-bypass procedure (`main` only, document each use)

If an actual production incident requires bypassing the ruleset:

1. Note the incident: ticket / message id, time, the exact change
   needed and why no PR-with-approval path works.
2. Edit the ruleset to set `enforcement = "disabled"` (or temporarily
   add owner to `bypass_actors` with `bypass_mode = "always"`).
3. Perform the action.
4. Restore the ruleset to its prior state.
5. Append to `INTEGRATION_LOG.md` within 24h: incident link, exact
   action taken, exact API calls, before/after `enforcement` values.

This is a documented procedure, **not** a config that lives in the
ruleset by default.

---

## Verifying the configuration (do this after applying)

```bash
# Rulesets
gh api repos/mmasoomi-glitch/naqdengi/rulesets --jq \
  '.[] | {name, enforcement, target, conditions: .conditions.ref_name.include}'

# Resolved effective rules for develop
gh api repos/mmasoomi-glitch/naqdengi/rules/branches/develop --jq '.'

# Resolved effective rules for main
gh api repos/mmasoomi-glitch/naqdengi/rules/branches/main --jq '.'
```

The lead session **only** updates `INTEGRATION_LOG.md` with
"branch protection configured" once those three queries return the
expected shape — never based on the assumption that the POST
succeeded.

---

## Why this matters — same as before

`block-dangerous-git.sh` and `.claude/settings.json` deny clauses
are **local** controls — present only when an agent runs through a
Claude Code session that has loaded this repository's settings.
They do not constrain:

- a developer using `git push` outside Claude;
- a CI script with broken assumptions;
- a future Claude session with a different `settings.json` loaded;
- a different MCP/automation tool with repository write access.

Server-side rulesets are the only mechanism that constrains all
writers uniformly. The single-owner-phase plan above is the
minimum that achieves "no force push, no deletion, every change
through PR + CI" without locking the owner out of their own
repository.

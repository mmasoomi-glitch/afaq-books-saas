# docs/coordination/GITHUB_BRANCH_PROTECTION_REQUIRED.md

## Status

**Not configured.** Verified on 2026-05-27 by the lead session:

```text
$ gh api repos/mmasoomi-glitch/afaq-books-saas/rulesets
[]

$ gh api repos/.../branches/main/protection
{"message":"Branch not found","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"404"}

$ gh api repos/.../branches/develop/protection
{"message":"Branch not found","documentation_url":"https://docs.github.com/rest/branches/branch-protection#get-branch-protection","status":"404"}
```

The 404s on `branches/{main,develop}/protection` are because *no
protection rule is set*. Both branches now exist (created in this
sprint), so the API is reachable; protection just hasn't been applied.

The authenticated GH CLI session (`mmasoomi-glitch`) has `admin:true`
on this repo, so the API calls below would succeed. The lead session
chose **not** to run them without explicit user authorization, because
configuring branch protection is a non-trivial, persistent change to
the repository's policy surface. See `CLAUDE.md` "executing actions
with care."

---

## What needs to be set

### For `main` (production)

- Require pull request before merging.
- Require at least **2 approvals** for production-sensitive changes
  (1 is acceptable until the team grows, but document the threshold).
- Require status checks: `governance-checks` (this sprint) plus the
  full CI pipeline (added in sprint 001).
- Require branch to be up-to-date before merging.
- Require linear history (no merge commits) **or** require signed
  commits — choose one and document.
- Block force pushes.
- Block branch deletion.
- Restrict who can push (only via approved PR).
- **Do not** allow administrators to bypass, except for tightly
  controlled emergency-administration recovery (and even then, prefer
  a documented procedure to a config bypass).
- Require conversation resolution before merging.

### For `develop` (approved integration)

- Require pull request before merging.
- Require at least 1 approval.
- Require status checks: `governance-checks` (this sprint) plus the
  full CI pipeline (added in sprint 001).
- Require branch to be up-to-date before merging.
- Block force pushes.
- Block branch deletion.
- Allow only approved integration pull requests from GITKEEPER
  (typically `integration/sprint-N → develop`).
- Bot/automation can push only via PR with passing checks.

---

## How to apply

### Option A — Recommended: ruleset via GitHub UI

1. Go to **Repository → Settings → Rules → Rulesets → New ruleset**.
2. Name: `protect-main`. Target: `main`. Enforcement: `Active`.
   Restrictions: enable "Restrict deletions", "Block force pushes",
   "Require a pull request before merging" (2 approvals, dismiss
   stale, require conversation resolution, require status checks).
3. Repeat with name `protect-develop`, target `develop`, 1 approval.

### Option B — API, via the authenticated `gh` CLI

The classic Branch Protection API. Run from any machine with `gh`
authenticated as a repository admin (e.g. `mmasoomi-glitch`):

```bash
# Protect main
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/afaq-books-saas/branches/main/protection \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]="governance-checks" \
  -F enforce_admins=true \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_code_owner_reviews=false \
  -F required_pull_request_reviews.required_approving_review_count=2 \
  -F required_pull_request_reviews.require_last_push_approval=true \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true \
  -F required_linear_history=false \
  -F lock_branch=false \
  -F allow_fork_syncing=false

# Protect develop
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/mmasoomi-glitch/afaq-books-saas/branches/develop/protection \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]="governance-checks" \
  -F enforce_admins=false \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_code_owner_reviews=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.require_last_push_approval=false \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true \
  -F required_linear_history=false \
  -F lock_branch=false \
  -F allow_fork_syncing=false
```

> **Note on bootstrap.** Setting `required_pull_request_reviews.
> required_approving_review_count=2` on `main` will block the
> sprint-000 PR from a solo reviewer. Choose one:
>
> - configure protection **after** the sprint-000 PR merges (faster);
> - or configure with `required_approving_review_count=1` now, raise
>   to 2 once the team is multiple humans (safer long-term, but the
>   bootstrap PR needs an approving reviewer that is not the author —
>   `enforce_admins=true` means even the owner can't self-merge).
>
> The PLATFORM-GUARDIAN sprint 001 will revisit this once `gh secret`,
> CI and the team shape are established.

### Verifying

After applying:

```bash
gh api repos/mmasoomi-glitch/afaq-books-saas/branches/main/protection \
  | jq '{ approvals: .required_pull_request_reviews.required_approving_review_count,
          force_pushes_allowed: .allow_force_pushes.enabled,
          deletions_allowed: .allow_deletions.enabled,
          required_checks: .required_status_checks.contexts }'
```

The lead session must update `INTEGRATION_LOG.md` with the API result
once protection is applied.

---

## Why this matters

`block-dangerous-git.sh` and `.claude/settings.json` deny clauses are
**local** controls — present only when an agent runs through a Claude
Code session that has loaded this repository's settings. They do not
constrain:

- a developer using `git push` outside Claude;
- a CI script with broken assumptions;
- a future Claude session with a different `settings.json` loaded;
- a different MCP/automation tool with repository write access.

Server-side branch protection is the only mechanism that constrains
all writers uniformly.

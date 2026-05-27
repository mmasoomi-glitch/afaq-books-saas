# .claude/hooks/

These shell scripts are wired in `.claude/settings.json` as PreToolUse
hooks. Claude Code invokes them via `bash`, so on Windows they require
**Git Bash** (which ships with Git for Windows and is already present
because you're using the `git` CLI).

## Hooks

- `block-dangerous-git.sh` — blocks unsafe Git invocations: pushes to
  `main`/`develop`, `--force*`, `--no-verify`, direct commits on
  protected branches, destructive resets/cleans, etc. See
  `.claude/rules/git-collaboration.md` for the policy and rationale.

- `check-agent-ownership.sh` — when an agent session identifies itself
  via the `AFAQ_AGENT` environment variable (the agent-prompt files set
  this), blocks writes into protected shared paths the agent doesn't
  own. See `docs/coordination/OWNERSHIP.md`.

## Testing a hook locally

Each hook reads a JSON payload from stdin. To test:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin develop"}}' \
  | bash .claude/hooks/block-dangerous-git.sh
echo "exit=$?"
```

A blocked call exits `2` and prints the reason to stderr. An allowed
call exits `0` silently.

## Limitations

These are **local** controls. They are bypassable by a determined user
(e.g. by editing `settings.json`). They are not a substitute for
**GitHub server-side branch protection** — see
`docs/coordination/GITHUB_BRANCH_PROTECTION_REQUIRED.md`.

## Not yet wired

- `pre-commit-quality-gate.sh` — intentionally **not** created during
  the bootstrap because the application stack (TypeScript, ESLint,
  Prisma, Vitest/Playwright) isn't installed yet. A pre-commit hook
  that runs commands which don't exist would either no-op silently
  (giving false reassurance) or fail every commit (blocking work).
  PLATFORM-GUARDIAN will add it in the sprint that scaffolds the
  Next.js application, once the commands are real.

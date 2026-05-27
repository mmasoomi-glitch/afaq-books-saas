#!/usr/bin/env bash
# .claude/hooks/check-agent-ownership.sh
#
# PreToolUse hook for Claude Code. When an agent identifies itself via
# the AFAQ_AGENT environment variable (set by the agent-prompt files in
# docs/coordination/agent-prompts/), this hook warns / blocks writes
# outside the agent's assigned paths.
#
# Behavior:
#   - Reads tool-call JSON from stdin.
#   - If the tool is Bash and the command looks like a write
#     (`>`, `>>`, `tee`, `sed -i`, `mv`, `rm`, `git rm`), and the
#     target path falls under a protected shared area but the calling
#     agent does not own it, block.
#   - If AFAQ_AGENT is unset, the hook is permissive (the lead session
#     may need to write anywhere).
#
# This is a guardrail, not a sandbox. It complements OWNERSHIP.md and
# the GitKeeper review step.

set -u

payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0

if command -v jq >/dev/null 2>&1; then
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  tool_name="$(printf '%s' "$payload" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  command_str="$(printf '%s' "$payload" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"(.*)"$/\1/')"
fi

[[ "$tool_name" != "Bash" ]] && exit 0
[[ -z "$command_str" ]] && exit 0

agent="${AFAQ_AGENT:-}"
if [[ -z "$agent" ]]; then
  # No agent identity set — lead session. Allow.
  exit 0
fi

# Protected shared areas. Edits here require explicit ownership.
protected_globs=(
  "CLAUDE.md"
  ".claude/"
  "docs/coordination/"
  "docs/IMPLEMENTATION_STATUS.md"
  ".github/"
  "prisma/schema.prisma"
  "prisma/migrations/"
  "package.json"
  "pnpm-lock.yaml"
  "package-lock.json"
  "yarn.lock"
  "next.config"
  "tsconfig.json"
)

# Ownership: which agent owns which protected glob. ARCHITECT and
# GITKEEPER may always edit, plus PLATFORM-GUARDIAN for CI/config and
# AUTH-TENANCY/LEDGER-CORE for their schema sections. The canonical
# table is docs/coordination/OWNERSHIP.md — this is a fast-path check.
declare -A owners=(
  ["CLAUDE.md"]="architect gitkeeper-integrator"
  [".claude/"]="platform-guardian architect gitkeeper-integrator"
  ["docs/coordination/"]="architect gitkeeper-integrator platform-guardian"
  ["docs/IMPLEMENTATION_STATUS.md"]="* "  # every agent updates its own module row
  [".github/"]="platform-guardian gitkeeper-integrator"
  ["prisma/schema.prisma"]="ledger-core auth-tenancy gitkeeper-integrator"
  ["prisma/migrations/"]="ledger-core auth-tenancy gitkeeper-integrator"
  ["package.json"]="platform-guardian architect gitkeeper-integrator"
  ["pnpm-lock.yaml"]="platform-guardian architect gitkeeper-integrator"
  ["package-lock.json"]="platform-guardian architect gitkeeper-integrator"
  ["yarn.lock"]="platform-guardian architect gitkeeper-integrator"
  ["next.config"]="platform-guardian architect gitkeeper-integrator"
  ["tsconfig.json"]="platform-guardian architect gitkeeper-integrator"
)

# Is the command a write that touches a path?
# Heuristic: presence of `>`, `>>`, `tee `, `sed -i`, `mv `, `rm `,
# `git rm `, or `cp ` followed by a path token that matches a protected
# glob.
cmd_lc="$(printf '%s' "$command_str" | tr '[:upper:]' '[:lower:]')"
is_write=0
for marker in '>' '>>' ' tee ' ' sed -i' ' mv ' ' rm ' ' git rm ' ' cp '; do
  if [[ "$cmd_lc" == *"$marker"* ]]; then
    is_write=1
    break
  fi
done

[[ "$is_write" -eq 0 ]] && exit 0

# For each protected glob, see if the command mentions it.
for glob in "${protected_globs[@]}"; do
  if [[ "$cmd_lc" == *"$glob"* ]]; then
    allowed="${owners[$glob]:-}"
    # '*' wildcard means every agent may write its own module row.
    if [[ "$allowed" == "* "* || "$allowed" == "* " ]]; then
      continue
    fi
    if [[ "$allowed" == *"$agent"* ]]; then
      continue
    fi
    cat >&2 <<EOF
[check-agent-ownership] DENIED: agent '$agent' attempted to write to a
protected shared area: $glob

Command:
  $command_str

Only these roles may write to $glob:
  $allowed

If you genuinely need this change:
  1. Open a handoff entry in docs/coordination/BLOCKERS.md
  2. Tag the listed owners
  3. Wait for GitKeeper to confirm the handoff

See docs/coordination/OWNERSHIP.md for the full ownership table.
EOF
    exit 2
  fi
done

exit 0

#!/usr/bin/env bash
# .claude/hooks/check-agent-ownership.sh
#
# PreToolUse hook for Claude Code. When an agent identifies itself via
# the NAGDENGI_AGENT environment variable (set by the agent-prompt files in
# docs/coordination/agent-prompts/), this hook warns / blocks writes
# outside the agent's assigned paths.
#
# Supported matchers (registered in .claude/settings.json):
#   Bash             -> payload has .tool_input.command
#   Write|Edit|NotebookEdit|MultiEdit -> payload has .tool_input.file_path
#
# Behavior:
#   - Reads tool-call JSON from stdin.
#   - Extracts write targets using shell-operator / command-name analysis.
#   - Resolves ownership via OWNERSHIP.md (longest-prefix-wins).
#   - NAGDENGI_AGENT unset -> exit 0 (lead session).
#   - Blocked agent     -> exit 2 + stderr message with handoff procedure.
#
# Dependencies: bash 4+, jq (optional — falls back to grep/sed).

set -u

payload="$(cat || true)"
[[ -z "$payload" ]] && exit 0

# ── Parse JSON payload ───────────────────────────────────────────

tool_name=""
file_path=""
command_str=""

if command -v jq >/dev/null 2>&1; then
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  tool_name="$(printf '%s' "$payload" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  file_path="$(printf '%s' "$payload" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  command_str="$(printf '%s' "$payload" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"(.*)"$/\1/')"
fi

# ── NAGDENGI_AGENT unset -> lead session -> allow ────────────────────

agent="${NAGDENGI_AGENT:-}"
if [[ -z "$agent" ]]; then
  exit 0
fi

# ── Collect write targets ────────────────────────────────────────

# Determine write targets into array WRITE_TARGETS[]
declare -a WRITE_TARGETS=()
# Redirection targets are tracked separately: they survive the pure-read
# filter, because `cat x > protected` writes `protected`.
declare -a REDIRECT_TARGETS=()

# For Write / Edit / NotebookEdit / MultiEdit: the file_path IS the write target
if [[ "$tool_name" == "Write" || "$tool_name" == "Edit" || "$tool_name" == "NotebookEdit" || "$tool_name" == "MultiEdit" ]]; then
  if [[ -n "$file_path" ]]; then
    WRITE_TARGETS+=("$file_path")
  fi
  # For these tool types, file_path is always a write — skip bash parsing
elif [[ "$tool_name" == "Bash" && -n "$command_str" ]]; then
  cmd="$command_str"

  # ── Detect heredoc: <<-, <<WORD -> treat entire cmd as having writes ──
  if echo "$cmd" | grep -qE '<<-?[[:space:]]*[A-Za-z_]'; then
    # Heredoc — content is unknown; any protected path = write
    # We'll check all paths below
    :
  else
    # ── Redirections: >, >>, 2>, &> ──
    # Extract targets after redirection operators
    # The operator may be followed by whitespace, so the target cannot be
    # matched with a bare [^ ]* — that yields an empty string for the very
    # common `echo x > file` form.
    _targets=$(echo "$cmd" | grep -oE '(>>|2>|&>|>)[[:space:]]*[^[:space:]|;&<>]+' 2>/dev/null \
               | sed -E 's/^(>>|2>|&>|>)[[:space:]]*//')
    if [[ -n "$_targets" ]]; then
      while IFS= read -r _t; do
        if [[ -n "$_t" ]]; then
          WRITE_TARGETS+=("$_t")
          REDIRECT_TARGETS+=("$_t")
        fi
      done <<< "$_targets"
    fi

    # ── Standalone commands that write: tee, sed -i, truncate, dd of=, install ──
    # tee FILE [FILE...]
    if echo "$cmd" | grep -qE '(^|[|;&])tee[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE '(tee|tee [^|&;]+)[[:space:]]+[^|&;]+' | sed -E 's/.*tee[[:space:]]+//' | tr ' ' '\n' | grep -v '^-' | grep -v '^$')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # sed -i ... FILE
    if echo "$cmd" | grep -qE 'sed[[:space:]]+-i'; then
      # Extract the FILE argument (last non-option arg, or the one after -i flags)
      _targets=$(echo "$cmd" | grep -oE 'sed[[:space:]]+-i(-[a-zA-Z]+)?[[:space:]]+[^|&;]+' | sed -E 's/.*sed[[:space:]]+-i(-[a-zA-Z]+)?[[:space:]]+//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # truncate FILE [FILE...]
    if echo "$cmd" | grep -qE '(^|[|;&])truncate[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'truncate[[:space:]]+[^|&;]+' | sed -E 's/truncate[[:space:]]+//' | tr ' ' '\n' | grep -v '^-' | grep -v '^$')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # dd of=FILE
    if echo "$cmd" | grep -qE '(^|[|;&])dd[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'of=[^|&; ]+' | sed -E 's/^of=//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # install SRC DEST (DEST is write target)
    if echo "$cmd" | grep -qE '(^|[|;&])install[[:space:]]'; then
      # Extract DEST: last arg after options
      _targets=$(echo "$cmd" | grep -oE 'install[[:space:]]+[^|&;]+' | sed -E 's/install[[:space:]]+//' | tr ' ' '\n' | tail -1)
      if [[ -n "$_targets" ]]; then
        WRITE_TARGETS+=("$_targets")
      fi
    fi

    # mv SRC DEST -> DEST is write target, SRC is not
    if echo "$cmd" | grep -qE '(^|[|;&])mv[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'mv[[:space:]]+[^|&;]+' | sed -E 's/mv[[:space:]]+//')
      dest=$(echo "$_targets" | tr ' ' '\n' | tail -1)
      if [[ -n "$dest" ]]; then
        WRITE_TARGETS+=("$dest")
      fi
    fi

    # cp SRC DEST -> DEST is write target, SRC is not
    if echo "$cmd" | grep -qE '(^|[|;&])cp[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'cp[[:space:]]+[^|&;]+' | sed -E 's/cp[[:space:]]+//')
      dest=$(echo "$_targets" | tr ' ' '\n' | tail -1)
      if [[ -n "$dest" ]]; then
        WRITE_TARGETS+=("$dest")
      fi
    fi

    # rm FILE...
    if echo "$cmd" | grep -qE '(^|[|;&])rm[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'rm[[:space:]]+[^|&;]+' | sed -E 's/rm[[:space:]]+//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # git rm FILE...
    if echo "$cmd" | grep -qE '(^|[|;&])git[[:space:]]+rm[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'git[[:space:]]+rm[[:space:]]+[^|&;]+' | sed -E 's/git[[:space:]]+rm[[:space:]]+//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # mkdir -p DIR
    if echo "$cmd" | grep -qE '(^|[|;&])mkdir[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'mkdir[[:space:]]+[^|&;]+' | sed -E 's/mkdir[[:space:]]+//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # rmdir DIR
    if echo "$cmd" | grep -qE '(^|[|;&])rmdir[[:space:]]'; then
      _targets=$(echo "$cmd" | grep -oE 'rmdir[[:space:]]+[^|&;]+' | sed -E 's/rmdir[[:space:]]+//')
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi

    # python3 -c "...", python -c "...", node -e "...", perl -e "...", ruby -e "..."
    # These are opaque — if a protected path appears anywhere, treat as write
    if echo "$cmd" | grep -qE '(^|[|;&])(python3?|node|perl|ruby)[[:space:]]+-[ce]'; then
      _targets=$(echo "$cmd" | grep -oE '[a-zA-Z0-9_][a-zA-Z0-9_./\-]*' | sort -u)
      if [[ -n "$_targets" ]]; then
        while IFS= read -r _t; do
          [[ -n "$_t" ]] && WRITE_TARGETS+=("$_t")
        done <<< "$_targets"
      fi
    fi
  fi

  # ── Check for pure reads: these NEVER produce write targets ──
  # cat, less, head, tail, grep, rg, git show, git diff, git log
  is_pure_read=0
  if echo "$cmd" | grep -qE '(^|[|;&])(cat|less|head|tail|grep|rg|git[[:space:]]+(show|diff|log))[[:space:]]'; then
    is_pure_read=1
  fi

  # A pure read does not make its ARGUMENTS write targets — `cat foo | head`
  # touches nothing. But a redirection target is a write no matter what
  # produced the bytes: `cat x > prisma/schema.prisma` overwrites the schema.
  # So clear the argument-derived targets and put the redirection targets back.
  if [[ "$is_pure_read" -eq 1 ]]; then
    WRITE_TARGETS=()
    if [[ ${#REDIRECT_TARGETS[@]} -gt 0 ]]; then
      WRITE_TARGETS=("${REDIRECT_TARGETS[@]}")
    fi
  fi
else
  # Unknown tool type -> allow
  exit 0
fi

# ── Normalise a path to repo-relative forward-slash form ─────────

normalize_path() {
  local p="$1"
  # Strip leading ./
  while [[ "$p" == ./* ]]; do
    p="${p#./}"
  done
  # Back to forward slashes before any prefix comparison, so a Windows-style
  # absolute path is handled the same way.
  p="${p//\\//}"
  # Strip the repository root prefix if the caller gave an absolute path.
  # CLAUDE_PROJECT_DIR is set by Claude Code; fall back to the cwd, which is
  # the repository root when the hook runs from .claude/settings.json.
  local root="${CLAUDE_PROJECT_DIR:-$PWD}"
  root="${root//\\//}"
  root="${root%/}"
  if [[ -n "$root" ]]; then
    p="${p#"$root"/}"
    p="${p#"$root"}"
  fi
  # Back to forward slashes (just in case)
  p="${p//\\///}"
  echo "$p"
}

# ── Build ownership map from OWNERSHIP.md ────────────────────────

OWNERSHIP_FILE="$(dirname "$(dirname "$(readlink -f "$0")")")/../docs/coordination/OWNERSHIP.md"
if [[ ! -f "$OWNERSHIP_FILE" ]]; then
  # Fallback: use embedded rules (should not happen)
  OWNERSHIP_FILE=""
fi

declare -a OWN_PATHS=()
declare -a OWN_AGENTS=()

# Function to add an ownership rule
add_rule() {
  local path="$1"
  local agents="$2"
  OWN_PATHS+=("$path")
  OWN_AGENTS+=("$agents")
}

# ── Embedded ownership map (derived from OWNERSHIP.md) ────────────
# Format: path  ->  agent1 agent2 ...
# Longest-prefix-wins when resolving.
# ANY means every agent is permitted.

add_rule "CLAUDE.md" "architect gitkeeper-integrator"
add_rule ".claude/" "platform-guardian architect gitkeeper-integrator"
add_rule ".github/" "platform-guardian gitkeeper-integrator"
add_rule "docs/coordination/INTEGRATION_LOG.md" "gitkeeper-integrator"
add_rule "docs/coordination/adr/" "architect gitkeeper-integrator"
add_rule "docs/coordination/schema-proposals/" "ANY"
add_rule "docs/coordination/BLOCKERS.md" "ANY"
add_rule "docs/IMPLEMENTATION_STATUS.md" "ANY"
add_rule "docs/coordination/" "architect gitkeeper-integrator platform-guardian"
add_rule "prisma/schema.prisma" "ledger-core auth-tenancy gitkeeper-integrator"
add_rule "prisma/migrations/" "ledger-core auth-tenancy gitkeeper-integrator"
add_rule "prisma/seed/" "ledger-core auth-tenancy gitkeeper-integrator"
add_rule "package.json" "platform-guardian architect gitkeeper-integrator"
add_rule "pnpm-lock.yaml" "platform-guardian architect gitkeeper-integrator"
add_rule "package-lock.json" "platform-guardian architect gitkeeper-integrator"
add_rule "yarn.lock" "platform-guardian architect gitkeeper-integrator"
add_rule "tsconfig" "platform-guardian architect gitkeeper-integrator"
add_rule "next.config" "platform-guardian architect gitkeeper-integrator"
add_rule "vitest.config" "platform-guardian architect gitkeeper-integrator"
add_rule "playwright.config" "platform-guardian architect gitkeeper-integrator"
add_rule "eslint.config" "platform-guardian architect gitkeeper-integrator"
add_rule "tailwind.config" "frontend-ux platform-guardian gitkeeper-integrator"
add_rule "docker-compose" "platform-guardian gitkeeper-integrator"
add_rule ".env.example" "platform-guardian gitkeeper-integrator"
add_rule "src/server/tx/" "ledger-core gitkeeper-integrator"
add_rule "src/server/auth/" "auth-tenancy gitkeeper-integrator"
add_rule "src/server/audit/" "auth-tenancy ledger-core gitkeeper-integrator"
add_rule "src/server/ai/" "documents-ai-safety gitkeeper-integrator"
add_rule "src/server/docs/" "documents-ai-safety gitkeeper-integrator"
add_rule "src/server/db/" "platform-guardian ledger-core gitkeeper-integrator"
add_rule "src/modules/ledger/" "ledger-core gitkeeper-integrator"
add_rule "src/modules/sales/" "sales-ar gitkeeper-integrator"
add_rule "src/modules/procurement/" "procurement-ap gitkeeper-integrator"
add_rule "src/modules/banking/" "banking-recon gitkeeper-integrator"
add_rule "src/modules/reports/" "reporting-analytics gitkeeper-integrator"
add_rule "src/modules/config/" "ledger-core architect gitkeeper-integrator"
add_rule "src/ui/" "frontend-ux gitkeeper-integrator"
add_rule "src/app/(auth)/" "auth-tenancy gitkeeper-integrator"
add_rule "src/app/(marketing)/" "frontend-ux gitkeeper-integrator"
add_rule "src/app/layout.tsx" "frontend-ux gitkeeper-integrator"
add_rule "tests/unit/ledger/" "ledger-core qa-auditor gitkeeper-integrator"
add_rule "tests/integration/ledger/" "ledger-core qa-auditor gitkeeper-integrator"
add_rule "tests/" "qa-auditor gitkeeper-integrator"

# ── Resolve ownership for each write target ──────────────────────

for raw_target in "${WRITE_TARGETS[@]}"; do
  target="$(normalize_path "$raw_target")"

  # No write targets -> allow
  [[ -z "$target" ]] && continue

  best_len=0
  best_rule=-1

  # Longest-prefix-wins: find the most specific matching rule
  for i in "${!OWN_PATHS[@]}"; do
    pattern="${OWN_PATHS[$i]}"
    plen=${#pattern}

    if [[ "$target" == "$pattern"* ]]; then
      if [[ "$plen" -gt "$best_len" ]]; then
        best_len=$plen
        best_rule=$i
      fi
    fi
  done

  # No rule matched -> ALLOWED (guardrail over shared areas, not a whitelist)
  [[ "$best_rule" -lt 0 ]] && continue

  allowed="${OWN_AGENTS[$best_rule]}"

  # "ANY" permits every agent
  if [[ "$allowed" == "ANY" ]]; then
    continue
  fi

  # Exact token match: split allowed on whitespace, compare with ==
  allowed_match=0
  for allowed_agent in $allowed; do
    if [[ "$agent" == "$allowed_agent" ]]; then
      allowed_match=1
      break
    fi
  done

  if [[ "$allowed_match" -eq 1 ]]; then
    continue
  fi

  # ── BLOCKED: agent does not own this path ────────────────────
  matched_rule="${OWN_PATHS[$best_rule]}"

  cat >&2 <<EOF
[check-agent-ownership] DENIED: agent '$agent' attempted to write to a
protected shared area: $target

Matched rule: $matched_rule -> allowed agents: $allowed

Command:
  $command_str

Only these roles may write to $target:
  $allowed

If you genuinely need this change:
  1. Open an entry in docs/coordination/BLOCKERS.md
  2. Tag the listed owners
  3. Wait for GitKeeper to confirm the handoff

See docs/coordination/OWNERSHIP.md for the full ownership table.
EOF
  exit 2
done

exit 0

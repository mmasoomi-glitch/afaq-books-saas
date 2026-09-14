#!/usr/bin/env bash
# .claude/hooks/block-dangerous-git.sh
#
# PreToolUse hook for Claude Code. Reads the tool-call JSON from stdin
# and blocks unsafe Git invocations on the Bash tool.
#
# Exit code semantics for Claude Code hooks:
#   0  -> allow the tool call to proceed
#   2  -> block the tool call; stderr is shown to the model
#   *  -> non-fatal failure; tool call proceeds (we never use this here)
#
# This hook is intentionally conservative: when in doubt it allows the
# call. The intent is to catch obvious classes of mistakes, not to be
# a substitute for GitHub server-side branch protection.

set -u

# --- 1. Read tool input from stdin --------------------------------------

payload="$(cat || true)"
if [[ -z "$payload" ]]; then
  # No payload — likely a different invocation context. Allow.
  exit 0
fi

# Extract the Bash command. We try jq first; if jq is missing we fall
# back to a coarse grep.
if command -v jq >/dev/null 2>&1; then
  command_str="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
else
  tool_name="$(printf '%s' "$payload" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"
  command_str="$(printf '%s' "$payload" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"(.*)"$/\1/')"
fi

# Only act on Bash tool calls.
if [[ -n "$tool_name" && "$tool_name" != "Bash" ]]; then
  exit 0
fi

# Empty command (or extraction failed) -> allow; nothing to inspect.
if [[ -z "$command_str" ]]; then
  exit 0
fi

# --- 2. Helper to deny with a clear message -----------------------------

deny() {
  local reason="$1"
  cat >&2 <<EOF
[block-dangerous-git] DENIED: $reason

Command that was blocked:
  $command_str

This guard exists because Naqdengi treats Git workflow safety as
load-bearing. See:

  CLAUDE.md
  .claude/rules/git-collaboration.md

Safe workflow:
  - All work branches start from origin/develop.
  - Never push to main or develop directly.
  - Never use --no-verify or --force.
  - Open a blocker in docs/coordination/BLOCKERS.md if you think you
    genuinely need a destructive action; do not work around the guard.
EOF
  exit 2
}

# Normalize: collapse whitespace, lowercase a copy for matching, but
# keep the original for the error message.
cmd_lc="$(printf '%s' "$command_str" | tr '[:upper:]' '[:lower:]')"
cmd_norm="$(printf '%s' "$cmd_lc" | tr -s '[:space:]' ' ')"

# --- 3. Pattern checks --------------------------------------------------

# 3a. --no-verify anywhere
if [[ "$cmd_norm" == *"--no-verify"* ]]; then
  deny "use of --no-verify is forbidden (hook/signing bypass)"
fi

# 3b/3c. Force pushes, and pushes targeting main or develop
#     The push is PARSED, one shell segment at a time, rather than matched as
#     a substring of the whole line (B-20260911-09). The old regex denied
#     `git push origin feat && gh pr create --base develop` because "develop"
#     appeared in the second command, and let `git push origin +feat` through
#     because a leading `+` forces without saying --force.
#
#     Each segment: find `git`, skip git's global options, require the
#     subcommand `push`, then read push's own arguments. The first positional
#     is the remote, the rest are refspecs. A refspec's destination is what
#     follows its last `:`, or the refspec itself.
segments="$(printf '%s' "$cmd_lc" | sed 's/[[:space:]]*\(&&\|||\|;\||\)[[:space:]]*/\n/g')"
while IFS= read -r seg; do
  [[ -z "$seg" ]] && continue
  read -ra words <<< "$seg"
  [[ ${#words[@]} -eq 0 ]] && continue

  # Strip quoting and substitution punctuation from both ends of each word,
  # so `bash -c 'git push --force x'` and `$(git push ...)` still parse.
  for i in "${!words[@]}"; do
    w="${words[$i]}"
    while [[ "$w" =~ ^[\"\'\(\$\`] ]]; do w="${w:1}"; done
    while [[ "$w" =~ [\"\'\)\`]$ ]]; do w="${w%?}"; done
    words[$i]="$w"
  done

  git_idx=-1
  for i in "${!words[@]}"; do
    if [[ "${words[$i]}" == "git" || "${words[$i]}" == */git ]]; then
      git_idx=$i
      break
    fi
  done
  [[ $git_idx -eq -1 ]] && continue

  sub_idx=-1
  for (( i = git_idx + 1; i < ${#words[@]}; i++ )); do
    case "${words[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace) (( i++ )) || true ;;
      -*) ;;
      *) sub_idx=$i; break ;;
    esac
  done
  [[ $sub_idx -eq -1 || "${words[$sub_idx]}" != "push" ]] && continue

  remote=""
  refspecs=()
  skip_next=false
  for (( i = sub_idx + 1; i < ${#words[@]}; i++ )); do
    arg="${words[$i]}"
    if $skip_next; then skip_next=false; continue; fi
    case "$arg" in
      -o|--push-option|--repo|--receive-pack|--exec) skip_next=true ;;
      --force|--force=*|--force-with-lease|--force-with-lease=*|--force-if-includes)
        deny "force pushes are forbidden on this repository" ;;
      --all|--mirror)
        deny "git push --all/--mirror would push main/develop; push one named branch" ;;
      --*) ;;
      -*)
        # Combined short flags, e.g. -uf
        [[ "$arg" == *f* ]] && deny "force pushes are forbidden on this repository" ;;
      *)
        if [[ -z "$remote" ]]; then remote="$arg"; else refspecs+=("$arg"); fi ;;
    esac
  done

  if [[ ${#refspecs[@]} -eq 0 ]]; then
    cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ "$cur" == "main" || "$cur" == "develop" ]]; then
      deny "bare git push while on $cur is forbidden; name the branch explicitly"
    fi
    continue
  fi

  for ref in "${refspecs[@]}"; do
    [[ "$ref" == +* ]] && deny "a +refspec is a force push and is forbidden"
    dst="${ref##*:}"
    dst="${dst#refs/heads/}"
    if [[ "$dst" == "main" || "$dst" == "develop" ]]; then
      deny "pushing to main or develop is forbidden; open a PR instead"
    fi
  done
done <<< "$segments"

# 3d. Destructive resets
if [[ "$cmd_norm" =~ git[[:space:]]+reset[[:space:]]+--hard ]]; then
  deny "git reset --hard is destructive; coordinate via BLOCKERS.md"
fi

# 3e. Destructive cleans
if [[ "$cmd_norm" =~ git[[:space:]]+clean[[:space:]]+-[a-z]*f ]]; then
  # git clean -f, -fd, -fdx, -fx
  deny "git clean -f* is destructive; coordinate via BLOCKERS.md"
fi

# 3f. Direct commit while on main/develop
if [[ "$cmd_norm" =~ git[[:space:]]+commit ]]; then
  current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$current_branch" == "main" || "$current_branch" == "develop" ]]; then
    deny "you are on $current_branch — commits to protected branches are forbidden. Switch to a feature branch."
  fi
fi

# 3g. Merge into main or develop from CLI
if [[ "$cmd_norm" =~ git[[:space:]]+merge ]]; then
  current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ "$current_branch" == "main" || "$current_branch" == "develop" ]]; then
    deny "merging into $current_branch from the CLI is forbidden; merges happen via approved PR with status checks"
  fi
fi

# 3h. Branch deletion targeting another agent's branch.
#     We can't perfectly know "another agent's branch" from text alone,
#     so the rule is strict: refuse `git branch -D` outright. Agents may
#     delete a branch they own via -d (safe delete) or via GitHub UI.
#
#     Matched on the CASE-PRESERVED command. Every other rule reads the
#     lowercased copy, in which `-D` cannot exist, so this rule used to be
#     dead code that let `git branch -D x` straight through.
cmd_cs="$(printf '%s' "$command_str" | tr -s '[:space:]' ' ')"
if [[ "$cmd_cs" =~ git[[:space:]]+branch[[:space:]] ]] &&
   [[ "$cmd_cs" =~ [[:space:]](-[a-zA-Z]*D[a-zA-Z]*|-[a-zA-Z]*(d[a-zA-Z]*f|f[a-zA-Z]*d)[a-zA-Z]*)([[:space:]]|$) ||
      ( "$cmd_cs" =~ [[:space:]](--delete|-d)([[:space:]]|$) && "$cmd_cs" =~ [[:space:]](--force|-f)([[:space:]]|$) ) ]]; then
  deny "force branch deletion (-D) is forbidden from agents; use -d or coordinate with GitKeeper"
fi

# 3i. Rebase of develop, main, or integration/* (rewrites published history)
if [[ "$cmd_norm" =~ git[[:space:]]+rebase ]]; then
  if [[ "$cmd_norm" =~ (^|[[:space:]])(develop|main|integration/) ]]; then
    deny "rebasing develop/main/integration is forbidden; only GitKeeper integrates"
  fi
fi

# 3j. git config edits (we use inline -c instead)
if [[ "$cmd_norm" =~ git[[:space:]]+config[[:space:]]+(--global|--system) ]]; then
  deny "writing global/system git config from an agent session is forbidden; use 'git -c key=value <cmd>' inline"
fi

# All checks passed.
exit 0

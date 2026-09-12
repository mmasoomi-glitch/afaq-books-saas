# .claude/hooks — Guardrail hooks

## check-agent-ownership.sh

PreToolUse hook that enforces **docs/coordination/OWNERSHIP.md** by examining
Claude Code tool-call JSON on stdin and blocking unauthorised writes with exit
code 2.

### Matchers

Two matcher entries are registered in `.claude/settings.json`:

| Matcher                              | Tool payloads intercepted         |
|--------------------------------------|-----------------------------------|
| `Bash`                               | Every Bash tool call              |
| `Write` `\|` `Edit` `\|` `NotebookEdit` `\|` `MultiEdit` | File-edit tool calls              |

A single script handles both:

* **Write / Edit / NotebookEdit / MultiEdit** — the file path comes from
  `.tool_input.file_path` and is always treated as a write target.

* **Bash** — write targets are extracted from `.tool_input.command` using
  shell-operator and command-name analysis (see below).

* **Anything else** — silently allowed (exit 0).

### Read vs. write detection

The hook distinguishes reads from writes using **SHELL OPERATOR** and
**COMMAND NAME**, not raw substring matching:

| Category            | Tokens / Commands                                         | Behaviour                                  |
|---------------------|-----------------------------------------------------------|--------------------------------------------|
| Redirections        | `>`, `>>`, `2>`, `&>` followed by a file path token       | The path token is a write target           |
| `tee FILE`          | Arguments after `tee`                                     | Targets are write targets                  |
| `sed -i`            | File argument                                             | Target is a write target                   |
| `truncate FILE`     | File arguments                                            | Targets are write targets                  |
| `dd of=FILE`        | `of=` value                                               | Target is a write target                   |
| `install SRC DEST`  | DEST argument                                             | DEST is write target, SRC is not           |
| `mv SRC DEST`       | DEST argument                                             | DEST is write target, SRC is not           |
| `cp SRC DEST`       | DEST argument                                             | DEST is write target, SRC is not           |
| `rm FILE...`        | File arguments                                            | All are write targets                      |
| `git rm FILE...`    | File arguments                                            | All are write targets                      |
| `mkdir -p DIR`      | Directory arguments                                       | All are write targets                      |
| `rmdir DIR`         | Directory arguments                                       | All are write targets                      |
| `python3 -c` …      | Any path token in command                                 | Conservative: every protected path = write |
| `python -c` …       | Same as above                                             | Conservative: every protected path = write |
| `node -e` …         | Same as above                                             | Conservative: every protected path = write |
| `perl -e` …         | Same as above                                             | Conservative: every protected path = write |
| `ruby -e` …         | Same as above                                             | Conservative: every protected path = write |
| Heredoc (`<<`)      | Any path token in command                                 | Conservative: every protected path = write |
| `cat`, `less`       | Pure read commands                                        | NOT writes even when output is redirected  |
| `head`, `tail`      | Pure read commands                                        | NOT writes even when output is redirected  |
| `grep`, `rg`        | Pure read commands                                        | NOT writes even when output is redirected  |
| `git show|diff|log` | Pure read commands                                        | NOT writes even when output is redirected  |

### Longest-prefix-wins resolution

When a file path matches multiple ownership rules, the **longest matching
prefix** wins. For example:

* `tests/integration/ledger/x.test.ts` matches both `tests/` and
  `tests/integration/ledger/` — the longer rule (`tests/integration/ledger/`)
  is used.
* `src/modules/ledger/posting.ts` matches both `src/modules/` and
  `src/modules/ledger/` — the longer rule wins.

This ensures granular rules take priority over broad catch-all rules.

### Owner matching

* The allowed-agents list from each rule is split on whitespace.
* The calling agent (`$NAGDENGI_AGENT`) is compared with **exact token equality**
  (`==`), not substring matching.
* If the rule says `ANY`, every agent is permitted.
* A path that matches **no** rule is **allowed** — this is a guardrail over
  shared areas, not a full whitelist.

### NAGDENGI_AGENT convention

* The hook reads the calling agent's slug from the environment variable
  `NAGDENGI_AGENT`.
* This variable is set by the agent-prompt files in
  `docs/coordination/agent-prompts/0*.md`.
* **If `NAGDENGI_AGENT` is unset**, the hook exits 0 (allow) — this covers the
  human lead session which may need to write anywhere.

### Error output

When blocking, the hook prints to stderr:

1. The agent slug that was denied.
2. The resolved (repo-relative) file path.
3. The matched ownership rule (pattern -> allowed agents).
4. The handoff procedure: open an entry in `docs/coordination/BLOCKERS.md`,
   tag the owner, wait for GitKeeper confirmation.

Exit code 2 signals the block to Claude Code.

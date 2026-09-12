# .claude/rules/git-collaboration.md

Detailed Git collaboration rules. `CLAUDE.md` is the headline; this file is
the enforcement detail.

---

## Branch model

```
main                   protected — production
develop                protected — approved integration
integration/sprint-N   GitKeeper-owned per-sprint integration
agent/NN-<role>-sprint-N   per-agent feature branch
chore/*, feat/*, fix/* legacy/general-purpose work branches
```

All implementation branches start from `origin/develop` at the recorded
sprint base SHA in `docs/coordination/SPRINT_BOARD.md`.

```bash
git fetch origin --prune
git switch -c agent/04-ledger-core-sprint-001 origin/develop
# verify base:
git merge-base --is-ancestor origin/develop HEAD && echo OK
```

Never branch implicitly from "whatever was checked out."

---

## Forbidden Git commands

The Claude hook `block-dangerous-git.sh` blocks these patterns when
executed via the Bash tool. They remain forbidden even when run outside
Claude:

- `git push … main`
- `git push … develop`
- `git push --force`, `--force-with-lease`, `-f`
- any command containing `--no-verify`
- `git commit` while `HEAD` is on `main` or `develop`
- `git reset --hard` (unless a one-time human-authorized recovery, recorded)
- `git clean -fd` or harsher (unless authorized, recorded)
- `git branch -D <other-agent-branch>`
- `git rebase` of any **published** branch you do not own
- `git merge` into `main` or `develop` (only GitHub PR + human approval)

If the hook blocks you, **stop and read the error message.** Do not try to
work around it. Document the situation in `BLOCKERS.md` instead.

---

## Pushing your branch

```bash
git push -u origin agent/04-ledger-core-sprint-001
```

Always pass the branch name explicitly. Never rely on `git push` with no
arguments — your tracking branch may be `develop` (a deliberate side-effect
of `git switch -c X origin/develop`), which would be blocked anyway, but
explicitness avoids accidents.

Do **not** push:

- `main`, `develop`, `integration/sprint-N`, or any branch you do not own.

---

## Commits

Use **Conventional Commits**:

```
<type>(<scope>): <subject>

<body, wrapped at 72 cols, explains WHY>

<footers if needed>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`,
`security`, `perf`, `build`, `ci`.

Scope examples: `ledger`, `auth`, `ar`, `ap`, `banking`, `reports`,
`docs-ai`, `ui`, `qa`, `ci`, `governance`.

Keep commits **small and coherent.** One concern per commit. If your diff
mixes "rename" + "add feature" + "fix bug", split it.

Commit author identity — for this empty-repo bootstrap window, the lead
session passes identity inline:

```bash
git -c user.name="<gh-account>" \
    -c user.email="<id>+<gh-account>@users.noreply.github.com" \
    commit -m "..."
```

Once a developer runs the project locally they will configure their own
git identity normally.

---

## Pull request flow

Worker branch → reviewer (QA-AUDITOR) → GitKeeper integration into
`integration/sprint-N` → full test pass on integration → single PR
`integration/sprint-N → develop` opened by GitKeeper.

Each PR description must include:

- Sprint number and base SHA.
- Files changed and migrations changed.
- Commands run and their actual exit status.
- Tests added and the count passing/failing.
- Known limitations and follow-up issues.
- Conflict resolution notes (GitKeeper only).

Never:

- Open a PR titled "WIP" and ask a human to merge.
- Open a PR claiming green tests without the test command output cited.
- Open a PR into `main` outside a release workflow.

---

## Conflict-prevention rules

1. Before editing, check `OWNERSHIP.md` — is this path yours?
2. Before editing a shared file, open a handoff entry in `BLOCKERS.md`
   and tag the owner.
3. If two agents need the same schema, the schema owner writes the
   migration; consumers write proposals under
   `docs/coordination/schema-proposals/`.
4. Do not "fix" another agent's failing test by editing their code —
   raise it with them or with QA-AUDITOR.
5. Never `git rebase` someone else's branch onto a newer base. The
   integration step lives with GitKeeper.

---

## Recovery from a mistake

If you commit to a wrong branch or stage files outside your ownership:

1. Do **not** force-push or reset hard.
2. Create a new correctly-named branch from the right base.
3. `git cherry-pick` the specific commits that are legitimately yours.
4. Tell the user / GitKeeper in `BLOCKERS.md` what happened.
5. Leave the original branch alone until GitKeeper decides what to do.

# .claude/rules/testing-release-gates.md

The gates a branch passes before it is integration-ready, and the gates
the integration branch passes before it is develop-ready.

---

## Per-branch gates (every agent, every push)

The stack is Next.js 15 + TypeScript + Prisma + Postgres + Auth.js v5,
but those tools are not yet installed in this repository (this is the
governance bootstrap). Until the application is scaffolded by the
ARCHITECT / PLATFORM-GUARDIAN sprint, the gates a branch must pass are:

- **Markdown / YAML lint** on any `.md`, `.yml`, `.yaml` you change.
- **Hook scripts** (`.claude/hooks/*.sh`) must `bash -n` parse cleanly.
- **No secrets** in the diff (`gitleaks` or equivalent in CI; manual
  review until CI is wired).
- **Conventional-commit subject lines** on every commit.
- **Sprint-board update** for your task.
- **Implementation-status update** for your module.

Once the application is scaffolded, the per-branch gates expand to:

- `pnpm typecheck` (or the chosen package manager) — zero TS errors.
- `pnpm lint` — zero errors. Warnings tracked, not blocking unless
  configured as such.
- `pnpm test` — unit + integration tests for changed paths pass.
- `pnpm test:e2e` — end-to-end tests for the touched user flow pass
  (skippable on docs-only diffs, with QA-AUDITOR sign-off).
- `pnpm prisma migrate diff` — no drift between schema and migrations.
- `pnpm build` — production build succeeds.
- Module-specific gates:
  - **Ledger-impacting**: accounting-invariant tests (balance,
    immutability, period lock) pass.
  - **Org-scoped data**: tenant-isolation tests pass (see
    `security-tenancy.md`).
  - **AI surface**: anti-hallucination tests pass (see
    `ai-hallucination-memory.md`).
  - **External provider**: contract tests against a recorded fixture
    OR a real provider sandbox.

The exact command names will be pinned by PLATFORM-GUARDIAN in
`package.json` scripts and reflected here in a follow-up commit.

---

## Sprint-board task gates

Before a task is marked `done` on `docs/coordination/SPRINT_BOARD.md`:

1. The agent has actually run the commands above and pasted the
   results (or links to CI runs) into the sprint board entry.
2. The agent has reviewed their diff for `no-mocks-no-stubs.md`
   violations.
3. Tests added cover the new logic (unit + at least one integration or
   e2e test where data persistence is involved).
4. Migrations (if any) are reviewed by the schema owner.
5. The agent has filed any new blockers it discovered.

Saying "I think it passes" without the output is **not** sufficient.

---

## Integration-branch gates (GitKeeper)

Before `integration/sprint-N` is proposed as a PR into `develop`,
GitKeeper verifies:

- The full repository test suite passes on a clean checkout.
- The production build succeeds on a clean checkout.
- `prisma migrate deploy` against a freshly-created database succeeds.
- `prisma migrate diff` shows no drift after deploy.
- The mock/stub audit (`no-mocks-no-stubs.md` scans) produces zero
  release-blocking findings.
- The security-review summary is filed in `INTEGRATION_LOG.md`.
- The accounting-integrity review summary is filed in
  `INTEGRATION_LOG.md`.
- The AI/memory-safety review summary is filed if any AI features
  shipped this sprint.
- All known blockers are either resolved or explicitly deferred with
  a recorded owner and date.

GitKeeper documents each of the above with the exact command output
or a CI link in `INTEGRATION_LOG.md`. Sign-off without evidence is a
process violation.

---

## Develop → main release gates (separate workflow)

Out of scope for the initial sprint. Will be defined in
`.github/workflows/release.yml` and a future ADR once `develop` has a
working application. Until then, nothing merges to `main` except the
documented bootstrap merges.

---

## How to cite test results in a PR or sprint-board entry

Use a fenced block with the command and the relevant lines of output:

```text
$ pnpm test packages/ledger
PASS  src/ledger/posting.test.ts (3.41s)
  posting
    ✓ balances debits and credits (12 ms)
    ✓ rejects unbalanced entry (4 ms)
    ✓ writes audit row on post (8 ms)
Tests: 3 passed, 3 total
```

Then a one-line summary: "All 3 ledger-posting tests pass on
agent/04-ledger-core-sprint-001 @ <SHA>."

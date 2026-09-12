# CLAUDE.md — Project Rules for Nagdengi

This file is read by every Claude Code session that operates on this repository.
It is mandatory, concise and non-negotiable. Detailed rules live in `.claude/rules/`.

---

## Read before touching code

Every agent, on every task, must read:

1. This file (`CLAUDE.md`).
2. The applicable files under `.claude/rules/`.
3. `docs/coordination/OWNERSHIP.md` — confirm your assigned paths.
4. `docs/coordination/SPRINT_BOARD.md` — confirm your assigned task and the sprint base SHA.
5. `docs/IMPLEMENTATION_STATUS.md` — confirm current truth of what works.

If any of these say something different from a memory you've cached, the file wins.

---

## Branching and Git — hard rules

- All work branches MUST originate from `origin/develop`.
- **Never** commit directly to `main`.
- **Never** commit directly to `develop`.
- **Never** push directly to `main`.
- **Never** push directly to `develop`.
- **Never** use `--no-verify`.
- **Never** use force push (`--force`, `--force-with-lease`, `-f`).
- **Never** bypass required status checks.
- **Never** rewrite or rebase another agent's published branch.
- Only `GITKEEPER-INTEGRATOR` performs merges into `integration/sprint-*`.
- Only an authorized human / GitHub protection merges into `develop` or `main`.

See `.claude/rules/git-collaboration.md`.

---

## Ownership — hard rules

- You may **read** any file.
- You may **edit only** the paths assigned to your agent role in
  `docs/coordination/OWNERSHIP.md`.
- If a task requires a file you do not own:
  1. Stop editing it.
  2. Open a blocker in `docs/coordination/BLOCKERS.md`.
  3. Message the owning agent / GitKeeper for a documented handoff.
- "Opportunistic cleanup" outside your owned paths is forbidden.
- Protected shared paths (`CLAUDE.md`, `.claude/**`, `docs/coordination/**`,
  root config, lockfiles, migrations) are touched only by their declared owner
  or GitKeeper, with a recorded reason.

---

## Truthfulness — hard rules

You may **never** present as working:

- Invented balances, invoices, payments, bank connections, reconciliations,
  tax filings or e-invoicing submissions.
- Fake AI confidence, fake evidence, fake provider success messages.
- Buttons that toast "Success" without real persistence.
- Endpoints that return 200 without authorization and storage.
- In-memory arrays or browser storage used as the production data store.
- Tests that were not actually run.
- Integrations that were not actually integrated.

Seed/demo data is allowed **only** in clearly labelled `*/fixtures/**` or
`*/seed/**` files, and never mixed with real user data paths.

See `.claude/rules/no-mocks-no-stubs.md` and
`.claude/rules/ai-hallucination-memory.md`.

---

## Accounting — hard rules

This is an accounting platform. Financial code must obey:

- Every posted journal **balances** (Σ debits = Σ credits).
- Posted ledger entries are **immutable** — corrections use reversal or
  controlled adjustment, never silent edit/delete.
- Period locks **prevent** unauthorized backdated changes.
- Reports derive **only** from persisted ledger data; never from UI constants
  or in-memory aggregates.
- Invoice payment status requires real payment-allocation evidence.
- Reconciliation status requires real matched-transaction evidence.
- Tax / compliance / e-invoicing features may not claim official submission
  without verified provider confirmation persisted to the audit trail.
- AI suggestions are suggestions only — they never become financial truth
  without grounded persisted data.

See `.claude/rules/accounting-integrity.md`.

---

## Security and tenancy — hard rules

- Authentication ≠ authorization. Auth.js sessions identify users.
  **Server-side** role/permission and **organization-membership** checks
  decide what they can read or write.
- Every financial record is scoped by organization. Every query, mutation,
  list endpoint and report must enforce that scope server-side.
- Cross-tenant access tests are required for any module touching
  organization-scoped data.
- Secrets never go in commits, prompts, logs or memory.

See `.claude/rules/security-tenancy.md`.

---

## Tests and release gates — hard rules

Before declaring a task complete:

- Run the project's typecheck, lint and tests as listed in
  `.claude/rules/testing-release-gates.md`.
- Add tests for new logic; integration tests for persistence/API changes;
  authorization tests for protected workflows; accounting-invariant tests
  for ledger-impacting work; tenant-isolation tests for org-scoped records.
- Never mark a task complete with failing or unrun tests, or with simulated
  behavior dressed up as real.

---

## Memory — hard rules

Auto-memory may store: reliable build/test commands, discovered structure,
stable conventions, debugging patterns.

Auto-memory must **never** store or assert: secrets, tokens, customer data,
production financial facts, unconfirmed provider behavior, fabricated
balances, or unresolved guesses presented as truth. The committed files
listed in "Read before touching code" are the source of truth — memory is
hints, not authority.

See `.claude/rules/ai-hallucination-memory.md`.

---

## Reporting protocol

When you finish a task, append/update entries in:

- `docs/coordination/SPRINT_BOARD.md` — your task status.
- `docs/IMPLEMENTATION_STATUS.md` — module truthful state.
- `docs/coordination/BLOCKERS.md` — anything not done and why.
- `docs/coordination/INTEGRATION_LOG.md` — only GitKeeper writes here.

Include: branch name, commit SHAs, files changed, migrations changed,
tests run with results, known limitations.

---

## When in doubt

Stop and write a blocker. Do not invent. Do not bypass. Do not soften
rules. The cost of pausing to confirm is low; the cost of fake or
unauthorized financial behavior is unbounded.

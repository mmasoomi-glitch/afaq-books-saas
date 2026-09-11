# docs/coordination/CONTEXT_LEDGER.md

Running state for the Claude session driving this repository. **Read this
first, at the start of every turn, before doing anything else.** Update it at
the end of every turn.

It exists so that context compaction, a session restart or a handover does not
lose where the work actually is. Anything not written here did not happen.

---

## Operating rules for this session (owner-directed)

1. **Sophia MCP does the work.** Authoring, fixing and verifying happen on the
   Sophia pod via `sophia_exec` / `opencode run`. The lead session writes specs,
   reviews diffs and lands commits. Do not hand-write implementation that a
   Sophia job could produce.
2. **Do not stop for confirmation or reporting.** Keep going.
3. **Questions go to `sophia_ask`, not the owner.** Only if `sophia_ask` returns
   `OWNER` does it wait for the human — and even then, keep working on
   everything that is not blocked by it.
4. **Fan out.** Run independent Sophia jobs concurrently when they touch
   disjoint files.
5. **Minimise lead-session tokens.** No long file dumps into context, no
   base64 round-trips when a checksum comparison will do, no polling sleeps
   longer than the job needs.

### GOTCHA — one database, many writers

**Broadcast to all projects via senate as `req_5f9ff7fee717`.**

Two Sophia jobs running at once against the same project destroy each other's
data, because each runs `pnpm test` and the suite truncates the shared database
between tests. Neither job knows the other exists.

It does not look like a race. It looks like ordinary logic bugs — "row not
found", "no record was found for a query", assertion mismatches — so you go
debugging the service layer, and the service layer is fine.

The same trap bites inside a single job, through the test runner:

- `vitest.config.ts` had `poolOptions.threads.singleThread: true`. **Vitest 2
  defaults to the `forks` pool, so the `threads` options are never read.** The
  setting did nothing; two test files ran in parallel against one database.
- Symptom: every file passed alone, 19 tests failed when run together.
- Fix: `fileParallelism: false`. That is the option that actually serialises.

Rules now in force:

1. **One Sophia job at a time per database.** Fan out only after giving each job
   its own database (`afaq_test`, `afaq_test2`, …) and its own
   `TEST_DATABASE_URL`.
2. **Prove the runner is serialised** — do not trust the config key name. Run
   per-file and whole-suite. If whole-suite fails and per-file passes, the
   parallelism setting is not doing what you think.
3. Prefer a per-job database over a per-job schema; truncate lists and
   migrations stay simple.

Two adjacent traps found the same day:

- **Prisma reads `DATABASE_URL`, not `TEST_DATABASE_URL`.** Unless the setup
  file pins `process.env.DATABASE_URL` to the test database, the code under test
  writes to the *development* database while assertions read the test one. Every
  test passes while proving nothing, and the run quietly mutates dev data.
- **`prisma migrate diff --shadow-database-url` RESETS whatever database it is
  given.** Point it at the test database and that database is left populated
  with no `_prisma_migrations` history, so the next `migrate deploy` dies with
  `P3005`. Give it a throwaway shadow database.

### Lessons already paid for — do not repeat

- **Sophia stalls if a prompt invites a question.** Every task file must open
  with an autonomous-mode preamble: no human available, never ask, apply edits
  immediately. Without it the job exits with the work half done.
- **Sophia's context limit is 64k.** A spec plus the files it must read has to
  fit. Split large jobs; a job that writes 7 files at once dies mid-way.
- **Sophia will write code that looks right and does nothing.** It produced
  `lockPeriod` that only read a row, `closePeriod` that closed nothing and
  `postJournalEntry` that never set `posted_at`. Every Sophia diff touching
  financial state must be read line by line before it lands, and the spec must
  name the exact DB effect each function must have.
- **The pod's canonical repo at `/workspace/repos/afaq-books-saas` disappears.**
  Re-clone before starting a job. Worktrees under `/root/wt-*` survive.
- **Transfer pod → local by checksum, not by eye.** A hand-copied base64 blob
  was corrupted once (md5 mismatch). Compare per-file `md5sum` between pod and
  local instead.

---

## Governance: judge and jury (owner-directed, 2026-09-11)

**FORGE BUILDS. SOPHIA JUDGES. THE ORCHESTRATOR DECIDES WORKFLOW.
OWNER INTENT IS THE CONSTITUTION. EVIDENCE OVERRIDES AGENT CONFIDENCE.**

- **Forge (worker)** — implementation, refactoring, tests, debugging, migrations.
  Forge never certifies its own work.
- **Sophia (judge)** — independent review of Forge's output, hidden defects,
  owner-intent compliance, security and tenant isolation, whether work is
  actually complete. Sophia inspects EVIDENCE, not the worker's explanation.
- **Orchestrator** — decomposes, delegates, reconciles, enforces verdicts.
  Never reinterprets REJECT as PASS. Never asks the judge to approve its own
  proposal. Never hides a failed test or a known uncertainty.

Request a verdict when a milestone finishes, when a worker claims complete,
when architecture changes, when tests pass but correctness is uncertain, when
security or tenant isolation is involved, before declaring completion. Not
after every trivial edit.

**Final completion gate:** BUILD pass + TESTS pass + SOPHIA verdict pass +
OWNER INTENT satisfied + no unverified critical items. If any is false, the
work is not complete.

### Operational notes on the two tools

- **Forge's repo-inspection tools are DOWN.** `forge_repo_status`,
  `forge_checkpoint_status` and `forge_runtime_status` all return
  `[remote] could not reach the Forge pod: exit 255`. Only the inference
  endpoint works (local tunnel, `127.0.0.1:8901`, model `forge-ai`, 131k
  context). Forge can therefore implement but cannot inspect this repository —
  it must be given context. Fixing that SSH hop would materially improve it.
- **Forge oscillates on under-specified rework and converges on precise
  rework.** Told vaguely to "fix the float arithmetic" it fixed that and
  simultaneously reintroduced a nested `$queryRaw` bug, used a wrong column
  name and changed an exported interface. Given exact function signatures and
  named defects it fixed everything and broke nothing. Always hand it the
  signatures.
- **`sophia_ask` does not emit the structured VERDICT block.** It either
  answers or routes to `OWNER`. Treat its substance as the verdict; use
  `sophia_review` for diff-level judgment.
- **Cross-project boundary:** other projects on the Sophia pod are OUT OF
  BOUNDS, including read-only listings. Only `afaq-*` paths and databases.

### Verdict history

| Date | Subject | Verdict | Outcome |
|------|---------|---------|---------|
| 2026-09-11 | Ledger + tenancy + authz + statements (106 tests) | PASS_WITH_CONDITIONS — two conditions | see below |
| 2026-09-11 | Condition 2 rework: report authorization gate (113 tests) | PASS | satisfied |

**Condition 1 — Row Level Security. DEFERRED, owner decision recorded.**
Sophia: "Deferring RLS is acceptable as the existing org-consistency trigger
and application-level filtering provide robust isolation, making it a safe
reversible follow-up." Tracked below as a follow-up; must be migrated into
`BLOCKERS.md` as `B-20260911-04` once PR #3 merges, because editing
`BLOCKERS.md` on this branch would collide with that PR.

**Condition 2 — report authorization gate. SATISFIED.** Sophia: "Condition 2
is satisfied; application-level gating is the current architectural standard,
and enforcing it via code review is sufficient for this stage."

### Open follow-ups not yet in BLOCKERS.md

- **RLS-001 (becomes `B-20260911-04`)** — enable Postgres Row Level Security as
  defence in depth for tenant isolation. Today isolation rests on
  application-level filtering in every query plus the `jl_org_consistency`
  trigger. ADR-0001 already flagged RLS as "strongly preferred" and left the
  sprint decision to ARCHITECT. Owner decision needed.
- **GATE-001** — nothing mechanically forces callers through `guarded.ts`. The
  unguarded services stay exported; the gate is a convention enforced by
  review. Sophia judged that acceptable for this stage. A lint rule or a
  branded scope type would make it structural.

---

## State — last hydrated 2026-09-11 (sprint 001 CLOSED, all PRs merged)

**`develop` @ `5f29213`. No open pull requests. 113 tests green.**

PRs #3, #4 and #5 merged on owner authorization, in that order, each synced and
re-run because the rulesets require branches to be up to date. Recorded in
`INTEGRATION_LOG.md` with the authorization noted explicitly.

### Merged and working

- **Ledger** — chart of accounts, periods, journals, posting, reversal, period
  locks, append-only audit log. The accounting invariants are enforced by
  PostgreSQL: deferred balance trigger firing at COMMIT, posted-row
  immutability, period non-overlap, org consistency across entry/line/account.
- **Tenancy** — organizations, users, per-organization memberships, sessions,
  OAuth links. All eight ledger tables carry a real FK to `organizations(id)`.
- **Authorization, enforced** — `resolveOrgScope` + `assertCanDo`, wired through
  `ledger/guarded.ts` (9 wrappers) and `reports/guarded.ts` (3 wrappers). Assert
  first, delegate second, so a refused call never reaches the database.
- **Statements** — trial balance, profit and loss, balance sheet. Posted rows
  only, summed in SQL, organization filtered on every joined table, money in
  Decimal end to end, and the balance-sheet identity enforced at exact equality.

### Blockers now open

| Id | Subject | Owner |
|----|---------|-------|
| `B-20260911-03` | `main` is behind `develop` and is the public default branch | repository owner |
| `B-20260911-04` | No Row Level Security — tenant isolation is application-level | ARCHITECT |
| `B-20260911-05` | Nothing mechanically forces callers through the authorization gate | ARCHITECT + PLATFORM-GUARDIAN |

`B-20260911-01` and `B-20260911-02` are closed.

### The honest limit of what exists

There is no user-facing application. Every module above is server-side with
integration tests. **Nothing is deployed, nothing is reachable over HTTP, and
no human has ever posted a journal entry through a screen.** There is also no
Auth.js session yet, so the authorization gate is only as trustworthy as
whatever eventually calls `resolveOrgScope` — today that is tests.

## Next actions, in order

1. **Auth.js v5** — the schema and the gate both exist; only the session does
   not. This is the single thing standing between "tested modules" and "an
   application". `resolveOrgScope` is already the seam it plugs into.
2. **`B-20260911-05`** — make gate bypass fail rather than merely be against
   convention. Cheapest option is a CI grep in the same shape as the existing
   invariant grep; strongest is a branded scope type the services demand.
3. **`B-20260911-04`** — ARCHITECT decides whether RLS lands in sprint 002.
4. **`B-20260911-03`** — owner decides whether `main` gets promoted or whether
   `develop` becomes the default branch.
5. GL drilldown, then SALES-AR — the first module that posts *through* the
   ledger rather than alongside it.

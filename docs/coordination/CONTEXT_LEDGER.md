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

## State — last hydrated 2026-09-11 (authz gate + statements landed)

**PR #5 is green in CI: 106 tests passing** on a real `postgres:14` container.
41 ledger invariants (raw SQL, bypassing Prisma), 20 ledger services,
11 authorization, 10 guarded-gate, 15 statements, 9 trial balance.

| Ref | State |
|-----|-------|
| `origin/main` | `3a91656`, empty root commit, still the public default branch (`B-20260911-03`) |
| `origin/develop` | `438bb59` |
| PR #3 / #4 / #5 | all 5/5 green, all awaiting the owner's merge |

### Built

- **Ledger** with invariants enforced by PostgreSQL: deferred balance trigger at
  COMMIT, posted-row immutability, period non-overlap, org consistency,
  append-only audit and lock logs.
- **Tenancy + foreign keys** — `B-20260911-02` closed.
- **Authorization is now an enforced GATE**, not just a tested component.
  `src/modules/ledger/guarded.ts` asserts the permission before delegating, so a
  refused call never reaches the database. Test G4 is the one that matters: a
  VIEWER posting gets ForbiddenError *and* `journalEntry.count` is still 0.
- **Statements** — profit and loss over a range, balance sheet as at a date with
  the accounting identity enforced at exact Decimal equality, no tolerance.

### Two real defects caught this round

- **Retained earnings summed expenses with the wrong sign.** The per-type CASE
  from P&L (which flips expenses positive so they can be shown in their own
  section and subtracted) was reused in the balance sheet, producing income PLUS
  expenses. The balance sheet then failed its own identity check by exactly twice
  the expenses. Retained earnings is just credits minus debits across
  profit-and-loss accounts. **The guard caught it, not a test assertion** — the
  report refused to render, which is what it was specified to do.
- **A test that could never pass.** The obvious test for the unbalanced guard —
  write a one-sided posted entry, assert it throws — is impossible:
  `je_balanced_check` is DEFERRABLE INITIALLY DEFERRED and fires at COMMIT
  however the rows are written, so the database refuses the corrupt state.
  Removed with the reason written down rather than shipped passing for the
  wrong reason.

### Tooling verdict — measured, not assumed

- **Sophia (qwen3-coder, 64k)** — reliable only on narrow, single-deliverable
  jobs with an autonomous preamble. Everything touching state must be read line
  by line: it shipped services that typechecked and did nothing, and silently
  marked eight foreign keys `NOT VALID`.
- **Forge (`forge-ai`, 131k)** — fast first drafts (7-35s per file) and the
  larger context is real. **But it oscillates under iteration rather than
  converging.** Asked to fix float arithmetic in the balance sheet it fixed that
  and simultaneously reintroduced a nested `$queryRaw` bug, used a wrong column
  name, and silently changed the exported interface. It also has no file tools,
  so every edit round-trips through the lead session's context. **Use it for
  first drafts and second opinions; do not use it for correction loops.**
- The working loop is: Forge or Sophia drafts -> lead session reviews for the
  known defect signatures -> **CI on real Postgres is the verifier**. CI caught
  the retained-earnings sign error that review missed.

## Next actions, in order

1. **Owner decision: merge PRs #3, #4, #5.** All green. Everything else in the
   sprint is blocked behind them — the doc updates specifically behind PR #3,
   which modifies the same three files.
2. Auth.js v5 wiring so a real session produces the OrgScope that `guarded.ts`
   already consumes. The schema and the gate both exist; only the session does not.
3. General-ledger drilldown (per-account transaction listing), reusing the
   statement query shape.
4. Then SALES-AR, which is the first module that posts through the ledger rather
   than alongside it.

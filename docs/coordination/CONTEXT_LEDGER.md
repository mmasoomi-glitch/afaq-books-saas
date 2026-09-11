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

## State — last hydrated 2026-09-11 (authz + trial balance landed)

**PR #5 is green in CI: 81 tests passing** against a real `postgres:14`
container — 41 ledger invariant tests (raw SQL, bypassing Prisma), 20 ledger
service tests, 11 authorization tests, 9 trial-balance tests.

| Ref | State |
|-----|-------|
| `origin/main` | `3a91656`, empty root commit, still the public default branch (`B-20260911-03`) |
| `origin/develop` | `438bb59`, governance bootstrap |
| PR #3 | intention contract, branch protection, sprint 001 — 5/5 green |
| PR #4 | ownership hook enforces Write/Edit + module paths — 5/5 green |
| PR #5 | ledger + tenancy + authz + trial balance — 5/5 green |

### Built

- **Ledger** — schema with the invariants enforced by PostgreSQL: deferred
  balance trigger firing at COMMIT, posted-row immutability, period
  non-overlap (`EXCLUDE USING gist`), org consistency across
  entry/line/account, append-only audit and lock logs.
- **Tenancy + FKs** — `B-20260911-02` CLOSED. All eight ledger tables have a
  real foreign key to `organizations(id)` `ON DELETE RESTRICT`.
- **Authorization** — `resolveOrgScope(userId, slug)` derives the org id
  server-side from a slug; `assertCanDo(scope, action)` checks by action key.
  Both membership and unknown-slug failures return the same message so the
  error cannot confirm another tenant's slug.
- **Trial balance** — sums in SQL from posted rows only, refuses to return an
  unbalanced result, no JavaScript number anywhere in the money path.

### THE GAP THAT MATTERS

**`assertCanDo` is not wired into anything.** The ledger services do not call
it, so a caller who invokes `postJournalEntry` directly bypasses authorization
entirely. The layer is tested but it is not yet a gate. This is the single most
important remaining item and it is the next job.

### Tooling verdict

- **Sophia (qwen3-coder, 64k)** — good on narrow, single-deliverable jobs with
  an autonomous preamble. Stalls or writes nothing on broad ones. Everything it
  produces that touches state must be read line by line: it shipped services
  that typechecked and did nothing, and silently added `NOT VALID` to eight
  foreign keys.
- **Forge (`forge-ai`, 131k)** — reachable and authorized, and the 131k context
  is genuinely double Sophia's. But the served model reasons poorly for this
  work: on a code review it contradicted itself three times, repeated one point
  four ways and truncated mid-sentence. It also has **no file tools**, so every
  edit round-trips through the lead session's context, which is strictly worse
  than Sophia's agent loop. **Verdict: not worth going overboard on.** Useful
  only as a cheap second opinion on small, self-contained questions — it did
  surface two real defects in the trial balance (silent "0" default, and the
  org filter applied to only one of three joined tables), both now fixed.
- **Fan-out works** with one database per job (`afaq_a`, `afaq_b`) in separate
  worktrees `/root/afaq-A` and `/root/afaq-B`. Never share a database.
- **Never put `kill`/`pkill` in the same `sophia_exec` call as other commands** —
  it kills the shell before they run. Cost two silently-lost job launches.

## Next actions, in order

1. **Wire `assertCanDo` into the ledger services** so authorization is an
   enforced gate rather than a tested component. Every mutating service takes an
   OrgScope and asserts its action before the write.
2. **Owner decision: merge PRs #3, #4, #5.** All green. The sprint doc updates
   are blocked behind PR #3 specifically, since all three doc files change there.
3. P&L and balance sheet, reusing the trial-balance query shape.
4. Auth.js v5 wiring so a real session produces the scope.

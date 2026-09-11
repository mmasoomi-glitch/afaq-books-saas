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

## State — last hydrated 2026-09-11 (after tenancy + FKs landed)

### Repository

| Ref | SHA | State |
|-----|-----|-------|
| `origin/main` | `3a91656` | empty root commit, 11 behind develop, public default branch (`B-20260911-03`) |
| `origin/develop` | `438bb59` | governance bootstrap, CI green |
| `chore/intention-contract-sprint-001` | pushed | PR #3 — all checks green |
| `fix/ownership-hook-write-edit` | pushed | PR #4 — all checks green |
| `agent/04-ledger-core-sprint-001` | `122057e` | PR #5 — **all checks green** |

Branch protection live: rulesets `protect-develop` (22882053) and `protect-main`
(22882054), both `enforcement: active`, verified via the resolved-rules endpoint.

### PR #5 — current CI evidence

```text
No migration drift between schema.prisma and migrations
  No difference detected.

Accounting-invariant tests
  tests/integration/ledger/invariants.test.ts (41 tests) 1763ms
  tests/integration/ledger/services.test.ts   (20 tests) 1220ms
       Tests  61 passed (61)

Assert the invariants are enforced by the DATABASE
  OK organization_id_fkey   (+ the 9 earlier invariants)
```

Runs on a `postgres:14` service container, so this is verified rather than
asserted.

### What is built

- **Ledger schema + database-level invariants** — debit/credit exclusivity,
  reporting-amount consistency, period non-overlap (`EXCLUDE USING gist`),
  org consistency across entry/line/account, posted-row immutability, a
  **deferred** balance constraint trigger, period-open enforcement,
  append-only audit and lock logs.
- **Tenancy** — `organizations`, `users`, `memberships`, `sessions`,
  `auth_accounts`, `verification_tokens`. Roles are per-organization on
  Membership; there is no global role. Auth.js's "Account" is `AuthAccount`
  here because `Account` is the chart of accounts.
- **Foreign keys on all eight ledger tables** → `organizations(id)`,
  `ON DELETE RESTRICT`. **This closed `B-20260911-02`.** Invariant I7 now
  holds at the database level, not just the service layer. `S20` asserts it.
- **Services** — `withTx` (Serializable + bounded retry on 40001/40P01/55P03
  only), `postJournalEntry`, `reverseJournalEntry`, periods
  (create/close/lock/unlock, each writing `period_locks` + audit), accounts.
- **CI** — `ledger-ci.yml`: real Postgres, drift check with its own throwaway
  shadow database, typecheck, tests, and a grep asserting each named invariant
  still exists in SQL.

### Still open

| Id | Subject | Owner |
|----|---------|-------|
| `B-20260911-01` | ownership hook gaps | fixed in PR #4, closes on merge |
| `B-20260911-03` | `main` behind `develop`, public default branch | repository owner |

- **Merge authority unresolved.** `sophia_ask` returned `OWNER`: `CLAUDE.md`
  says only an authorized human merges into develop/main. All three PRs are
  green and waiting.
- No UI, no auth wiring, no invoices, no reports — excluded by contract C2.
- `assertCanDo` / `resolveOrgScope` do not exist yet. `LedgerScope` is still
  constructed by the caller; AUTH-TENANCY must derive it from a session.
- Doc updates (`SPRINT_BOARD`, `IMPLEMENTATION_STATUS`, `TODO_SPRINT_001_LEDGER`)
  are deliberately **not** in PR #5 — all three are modified in PR #3 and
  editing them twice guarantees a conflict. They land once PR #3 merges.

### Sophia status

Inference jobs **stopped at owner request** — the owner needs the GPU. Shell
calls to the pod (`sophia_exec`) do not use inference and remain fine for
reading files. The pod worktree `/root/wt-afaq-ledger-schema` holds the same
work; local and CI are now the source of truth.

What Sophia produced that needed correcting, for the record: services that
typechecked and did nothing (`lockPeriod` that only read a row, `closePeriod`
that closed nothing, `postJournalEntry` that never set `posted_at`), and eight
foreign keys silently marked `NOT VALID` when the spec did not ask for it.

## Next actions, in order

1. **Owner decision needed**: merge PRs #3, #4, #5 (all green), or delegate
   merge authority to this session. Nothing else in the sprint can close until
   they land — the doc updates are blocked behind PR #3 specifically.
2. After PR #3 merges: update `SPRINT_BOARD.md`, `IMPLEMENTATION_STATUS.md` and
   `TODO_SPRINT_001_LEDGER.md` with the real test counts and the closure of
   `B-20260911-02`.
3. Next build slice (AUTH-TENANCY): `resolveOrgScope(req)` and
   `assertCanDo(scope, action)`, plus the five tenant-isolation test surfaces
   required by `security-tenancy.md`. The schema for it already exists.
4. Then REPORTING-ANALYTICS: trial balance computed from posted ledger rows
   only, with a test comparing it against a freshly-summed control.

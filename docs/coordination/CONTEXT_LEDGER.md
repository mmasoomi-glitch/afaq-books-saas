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

## State — last hydrated 2026-09-11

### Repository

| Ref | SHA | State |
|-----|-----|-------|
| `origin/main` | `3a91656` | empty root commit, 11 behind develop, public default branch (`B-20260911-03`) |
| `origin/develop` | `438bb59` | governance bootstrap, CI green |
| `chore/intention-contract-sprint-001` | pushed | PR #3 |
| `fix/ownership-hook-write-edit` | pushed | PR #4 |
| `agent/04-ledger-core-sprint-001` | pushed | PR #5 |

Branch protection is **live**: rulesets `protect-develop` (22882053) and
`protect-main` (22882054), both `enforcement: active`, verified via the
resolved-rules endpoint.

### Open pull requests

| PR | Title | Checks | Blocked on |
|----|-------|--------|-----------|
| #3 | intention contract v1, branch protection, sprint 001 open | all 5 green | owner merge |
| #4 | ownership hook enforces Write/Edit and module paths | all 5 green | owner merge |
| #5 | ledger schema, invariants, services, tests | governance green; **ledger job failing** | see below |

**Merge authority is unresolved.** `sophia_ask` returned `OWNER`: `CLAUDE.md`
says "only an authorized human merges into develop or main", and the session
must not merge its own PRs until the owner says otherwise. Everything else
continues regardless.

### PR #5 — where the ledger actually is

Green on the pod (`/root/wt-afaq-ledger-schema`): `pnpm typecheck` exits 0 and
`pnpm test` is **60 passed / 60** (41 raw-SQL invariant tests + 19 service
tests) against real PostgreSQL 14.24.

CI has been chasing the pod. Fixed so far, each a real portability defect:

1. `npx prisma` not resolvable under pnpm → resolve `node_modules/.bin/prisma`.
2. `stdio: "ignore"` hid every migration error → capture stdout/stderr.
3. `migrate diff` was handed the test database as its own shadow → gave it a
   throwaway `afaq_shadow`.
4. Prisma client never generated on the runner → added `pnpm prisma generate`.
5. `client.ts` had a self-referential type (TS2502) which degraded `prisma` to
   `any` and produced six unrelated implicit-any errors → rewritten.

Last push `953f426` carries fix 5; **its CI result has not been read yet.**
That is the first thing to check next turn.

### What exists in the ledger

- `prisma/schema.prisma` — 8 models, Decimal(18,4) money, no float anywhere.
- `prisma/migrations/20260911065811_init_ledger/` — the invariants that matter,
  all enforced by PostgreSQL: debit/credit exclusivity, reporting-amount
  consistency, period non-overlap (`EXCLUDE USING gist`), org consistency
  across entry/line/account, posted-row immutability, a **deferred** balance
  constraint trigger, period-open enforcement, append-only audit and lock logs.
- `src/server/tx/with-tx.ts` — Serializable + bounded retry on 40001/40P01/55P03
  only; `withTxUsing` exposes the retry loop for testing without a database.
- `src/modules/ledger/` — `accounts`, `periods`, `posting`, `errors`, `scope`.
- `tests/integration/ledger/` — `invariants.test.ts` (41), `services.test.ts` (19).
- `.github/workflows/ledger-ci.yml` — postgres:14 service, drift check, tests,
  plus a grep asserting each named invariant still exists in the migration.

### Known limitations, all recorded

- `organization_id` carries **no foreign key** (owner-directed, `B-20260911-02`).
  Invariant I7 holds at the column and service layer only. `jl_org_consistency`
  is the compensating control. AUTH-TENANCY must add the FKs.
- No UI, no auth, no invoices — excluded by contract clause C2.
- The audit log has a writer only for ledger actions.

### Open blockers

| Id | Subject | Owner |
|----|---------|-------|
| `B-20260911-01` | ownership hook gaps | PLATFORM-GUARDIAN — **fixed in PR #4**, closes on merge |
| `B-20260911-02` | ledger `organization_id` has no FK | AUTH-TENANCY |
| `B-20260911-03` | `main` behind `develop`, public default branch | repository owner |

### Pod environment

`/workspace/repos/afaq-books-saas` (re-clone if missing) and worktree
`/root/wt-afaq-ledger-schema`. PostgreSQL 14.24 running, databases `afaq_dev`
and `afaq_test`, role `afaq`. Node 22.20, pnpm 9.15.4 at
`/workspace/node/bin/pnpm`. No Docker daemon.

Launch a job with:

```bash
nohup bash -c 'source /root/.sophia-env 2>/dev/null; \
  export PATH="/workspace/node/bin:$PATH"; \
  cd /root/wt-afaq-ledger-schema && \
  opencode run --model sophia/qwen3-coder "$(cat /workspace/tasks/NAME.md)" \
  > /workspace/logs/oc-NAME.log 2>&1; \
  echo OC_EXIT=$? >> /workspace/logs/oc-NAME.log' >/dev/null 2>&1 &
```

---

## Next actions, in order

1. Read the CI result for `953f426` on PR #5.
2. If red, write the failure into a Sophia task file and let Sophia fix it on
   the pod; do not hand-fix.
3. Sync any pod fix back by per-file `md5sum` comparison, commit, push.
4. When PR #5 is green, update `SPRINT_BOARD.md`, `IMPLEMENTATION_STATUS.md`
   and `TODO_SPRINT_001_LEDGER.md` — deferred until PR #3 merges, because all
   three files are modified there and editing them twice guarantees a conflict.
5. Remaining TODO phases: reporting has not started; AUTH-TENANCY is next after
   the ledger lands.

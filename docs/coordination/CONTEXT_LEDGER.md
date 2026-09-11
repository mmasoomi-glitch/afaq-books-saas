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

## State — last hydrated 2026-09-12 (HTTP layer in review)

**PR #11 open** from `agent/03-http-layer-sprint-002` @ `04e710e`, against the
base branch @ `4ec44af`. **209 tests green**, typecheck clean, no migration
drift — all verified on the Sophia pod against a real PostgreSQL 14.

### The chain now reaches HTTP

`HttpRequest` → `signInHandler` → `signIn` → session row storing only a sha256
of the token → `__Host-session` cookie → `sessionHandler` → `resolveSession` +
`touchSession` → `resolveOrgScope` (membership re-checked per request) →
`assertCanDo` → `guarded.ts` → ledger services → database invariants.

**What is still missing is a socket.** The handlers exist and are tested; no
Next.js scaffold serves them, so no endpoint is reachable by a browser. That is
now the single thing standing between tested modules and an application.

### Merged, and what each layer actually guarantees

- **Ledger** — invariants enforced by PostgreSQL: deferred balance trigger at
  COMMIT, posted-row immutability, period non-overlap, org consistency.
- **Tenancy** — real foreign keys on all eight ledger tables.
- **Authorization** — 12 guarded wrappers; a branded `LedgerScope` makes
  accidental bypass a compile error (`B-20260911-05`, PR #10).
- **Statements** — trial balance, P&L, balance sheet, identity exact.
- **Sessions** — argon2id at OWASP parameters, tokens stored only as sha256,
  unknown email indistinguishable from wrong password, revocation effective on
  the next request.
- **Rate limiting** — Postgres fixed window on both address and account,
  progressive delay not lockout, fails **open** deliberately (PR #9).

### In review (PR #11)

- **HTTP layer** — plain object in, plain object out, no framework import,
  enforced by a CI grep.
- **Cookies** — `__Host-session` / `__Host-csrf`. The prefix is load-bearing:
  it is what makes a browser refuse a shadowing cookie set by a sibling
  subdomain. Accepted cost — the cookie cannot span subdomains.
- **CSRF** — double-submit plus an exact-match Origin check.
- **Two session clocks** — idle 24h (slides on use), absolute 14d anchored on
  `sessions.created_at` (renewal may not cross it). Without the second,
  sliding renewal means a stolen token lives forever if the thief keeps using
  it.

### Open blockers

| Id | Subject | Owner | Gate |
|----|---------|-------|------|
| `B-20260911-03` | `main` behind the base branch, and still the public default | owner | — |
| `B-20260911-04` | No Row Level Security | ARCHITECT | — |
| `B-20260911-07` | No reaper scheduler for expired rate-limit rows | AUTH-TENANCY | — |
| `B-20260911-08` | Nothing reads `security_events` | AUTH-TENANCY | — |
| `B-20260911-09` | `block-dangerous-git.sh` matches substrings | PLATFORM-GUARDIAN | fires on prose |
| `B-20260912-01` | Sign-in/registration cannot be double-submit protected | AUTH-TENANCY + FRONTEND-UX | needs a sign-in page |
| `B-20260912-02` | CSRF token not bound to the session | AUTH-TENANCY | — |
| `B-20260912-03` | Email uniqueness enforced by the service, not the DB | AUTH-TENANCY + LEDGER-CORE | needs a drift-gate decision |

Closed since the last hydration: `-05`, `-06`, `-10`.

**`B-20260911-09` fired twice this session, both times on prose.** A
feature-branch push was denied because unrelated documentation text in the same
command line contained the word "subdomain" — which contains "main" — next to
the words describing the guard itself. The guard was not bypassed either time;
the commands were split, and the file was written with an editor tool instead
of a shell heredoc. Worth fixing, because a guard that cries wolf is a guard
people learn to route around.

### Verdict history

| Subject | Verdict | Outcome |
|---------|---------|---------|
| Ledger + tenancy + authz + statements (106 tests) | PASS_WITH_CONDITIONS ×2 | see below |
| Condition 2: report authorization gate (113 tests) | PASS | satisfied |
| Condition 1: Row Level Security | deferred | `B-20260911-04` |
| Session layer (127 tests) | PASS_WITH_CONDITIONS | `B-20260911-06`, now closed |
| HTTP transport decisions (asked in advance) | DECIDED | `B-20260911-10`, implemented |
| Cookie Max-Age vs 14-day session | DECIDED: sliding renewal + `__Host-` | implemented |
| HTTP layer security (209 tests) | **1 real defect found** | email case; fixed in-branch |

### GOTCHA — a judge that answers about the wrong repository

`sophia_review` was called with `project: "/root/afaq-A"` and an explicit
`paths` list. It returned:

```
[review http-sec-review  project sophia_app  base main  model qwen3-coder]
FINDINGS: NONE
```

It silently reviewed **a different codebase entirely** and reported a clean
bill of health for code it had never opened. Had that been accepted, PR #11
would carry "independent review: no findings" while containing a live
account-confusion defect.

**Rule: read the echoed project and base on every verdict.** A `NONE` from the
wrong input is worse than no verdict, because it looks like evidence. When the
target cannot be confirmed, paste the source into `sophia_infer` directly —
that is what found the defect, within one call.

This also matters for the owner's standing constraint that nothing here may
cross into other projects. `sophia_review` reaching another project unasked is
exactly the boundary that was ruled out, so it is not to be used for this
repository until it honours the project argument.

### Tooling, as measured

**Forge, this round: good first drafts, predictable defects.** Four files
authored from precise specifications. Every one needed the same three classes
of fix and nothing worse:

1. `exactOptionalPropertyTypes` — it writes `{ cookies: res.cookies }` where
   the property is optional and the value may be `undefined`. Needs a
   conditional spread.
2. `noUncheckedIndexedAccess` — it indexes and then uses the result as a
   definite value (`value[i]`, `match[1]`).
3. Dropped arguments and wrong shapes in tests — `assertSameOrigin(req)`
   missing its expected origin; asserting `body.code` where the body is
   `{ error: { code } }`.

It also emitted a self-import (`import type { HttpMethod } from "./types.js"`
inside `types.ts`) and one comment whose *reasoning* was wrong while the code
was right: it claimed taking the first of two same-named cookies wins because
that one is "the most recently set", which browsers do not guarantee — they
order by path specificity. Corrected to say the choice is arbitrary and the
`__Host-` prefix is the real defence.

**This confirms the earlier rule from the other direction.** Every one of these
was fixed by local edits, and every file converged. No file was sent back for a
rewrite, and nothing regressed. Forge is a first-draft generator; the editing
stays here.

**Sophia as judge still earns its place — when given real input.** Fed the
actual source, it found in one pass a defect that 206 passing tests did not:
`enforce` lowercased the email for its rate-limit key while `signIn` looked the
user up by the raw string, so `Admin@corp.com` and `admin@corp.com` were two
separate accounts. Its output is verbose and visibly argues with itself; the
signal is there, but it has to be read rather than skimmed.

## Next actions, in order

1. **Next.js 15 scaffold (`002-5`).** The only thing between tested modules and
   an application. Route handlers delegate to `src/server/http/` — the adapter
   is the only place framework types are allowed, and CI enforces that.
2. **`B-20260912-01`** once a sign-in page exists: a pre-session token, closing
   login CSRF.
3. `B-20260912-03` — decide how `prisma migrate diff --exit-code` should treat
   database objects Prisma cannot model, then add the `lower(email)` index. The
   same question already applies to every trigger in the init migration.
4. `B-20260911-04` — ARCHITECT decides on RLS.
5. Then SALES-AR: the first module that posts *through* the ledger.

---

## Superseded — hydrated 2026-09-11 (session layer merged)

**`develop` @ `2f73126`. No open PRs. 127 tests green** on a real `postgres:14`
container. Five PRs merged today: #3, #4, #5, #6, #7.

### The chain is now complete, end to end

`signIn` → session row storing only a sha256 of the token → `resolveSession` →
`resolveOrgScope` (membership re-checked per request) → `assertCanDo` →
`guarded.ts` wrappers → ledger services → database invariants.

A caller can go from an email and a password to a posted, balanced, audited
journal entry, and every step refuses what it should refuse. **What does not
exist is anything that speaks HTTP.**

### Merged

- **Ledger** with PostgreSQL-enforced invariants (deferred balance trigger at
  COMMIT, posted-row immutability, period non-overlap, org consistency).
- **Tenancy** with real foreign keys on all eight ledger tables.
- **Authorization**, enforced through 12 guarded wrappers.
- **Statements** — trial balance, P&L, balance sheet, identity enforced exactly.
- **Sessions** — argon2id at OWASP parameters, tokens stored only as sha256,
  unknown email indistinguishable from wrong password, membership revocation
  effective on the next request.

### Open blockers

| Id | Subject | Owner | Gate |
|----|---------|-------|------|
| `B-20260911-03` | `main` behind `develop`, public default branch | owner | — |
| `B-20260911-04` | No Row Level Security | ARCHITECT | — |
| `B-20260911-05` | Nothing forces callers through the gate | ARCHITECT + PG | — |
| `B-20260911-06` | **No rate limiting** | owner + AUTH-TENANCY | **blocks the HTTP layer** |

`B-20260911-06` is the one with teeth. The judge's condition was explicit:
implement the rate limiter *before enabling the HTTP layer*. argon2id raises
the price of a guess but does not cap the rate, and the dummy-verify defence
answers a different attack entirely.

### Verdict history

| Subject | Verdict | Outcome |
|---------|---------|---------|
| Ledger + tenancy + authz + statements (106 tests) | PASS_WITH_CONDITIONS ×2 | see below |
| Condition 2: report authorization gate (113 tests) | PASS | satisfied |
| Condition 1: Row Level Security | deferred | `B-20260911-04` |
| Session layer (127 tests) | PASS_WITH_CONDITIONS | `B-20260911-06` gates HTTP |

### Tooling, as measured

**Forge oscillated destructively on this round and it is worth recording.** Sent
a rework of `session.ts` naming three precise defects, it fixed the first and
then: redefined `AuthError` (which the same file imports), changed the session
TTL from 14 to 30 days, deleted two exported error classes and an exported
function, reordered `registerUser`'s parameters, and invented Prisma column
names (`tokenHash`, `expiresAt`) that do not exist in the schema.

Its FIRST draft of that file was structurally sound and needed only three
fixes. The lesson is sharper than "give it exact signatures": **on a file where
the first draft is close, apply the fixes yourself rather than asking for a
rewrite.** Forge is a first-draft generator, not an editor.

Its earlier converged rework — the guarded-reports test, where it was given
exact signatures and named defects — still stands as the counter-example. The
difference seems to be whether the rework is *local edits* (converges) or
*regenerate the whole file* (regresses).

## Next actions, in order

1. **`B-20260911-06` — rate limiting.** Now the critical path: it gates the HTTP
   layer, and the HTTP layer is what turns this from tested modules into an
   application. Owner picks Postgres or Redis; limit per source address AND per
   account, because those defend against different attacks.
2. **HTTP layer**, once (1) lands. Cookies with `HttpOnly`, `Secure`,
   `SameSite`, CSRF handling, and the security headers `security-tenancy.md`
   already specifies. `resolveScopeFromSession` is the seam.
3. `B-20260911-05` — make gate bypass fail rather than be against convention.
4. `B-20260911-04` — ARCHITECT decides on RLS.
5. Then SALES-AR: the first module that posts *through* the ledger.

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

## State — last hydrated 2026-09-13 (namespace fixed, debt is the backlog)

**Base branch @ `6f53490`. No open PRs. 349 tests, lint clean, build green,
typecheck clean, no drift.** PR #35 merged since the last hydration.

`B-20260913-01` is **closed** — the one item with a closing window, done while
it was still two directory renames. Organizations live at `/o/{slug}/…` and
`/api/o/{slug}/…`; the reserved-word list is gone rather than longer.

Verified by doing the thing the list existed to prevent: an organization
slugged `members` is created, renders at `/o/members/accounts`, and its API
works — and so does one called `api`. Old URLs 404. Format still enforced.

### The reserved-list lesson, generalised

The list had needed extending **twice in one session**, and the third time was
a matter of when rather than whether.

> A list that must be updated every time an unrelated thing changes is not a
> safeguard. It is a recurring obligation that will eventually be forgotten by
> someone who had no reason to know it existed.

Worth applying to anything else in this repo that looks like it: a set of
strings kept in sync with a set of files by nothing but attention.

### The vacuous-check tally reached SIX, and one of them was the counter itself

| # | The check | What was wrong |
|---|-----------|----------------|
| 1 | CI grep for `posting.js` | matched nothing after the extension removal |
| 2 | `sophia_review` | answered about a different repository |
| 3 | `await expect(() => syncFn()).toThrow()` | the `await` hid that the assertion is vacuous on a rejection |
| 4 | a test mock hardcoding `"__Host-session"` | a rename would pass four of seven tests silently |
| 5 | the framework-import gate | **worked** — and caught its own author, twice |
| 6 | the DB-invariant needle list | matched a constraint name inside a `DROP CONSTRAINT` |

Number 6 is the sharpest: the gate would have reported a constraint present
while the only migration mentioning it was the one that removed it. Found by
reading the file instead of trusting a script's own "success" output.

**The standing question for any new gate: what input would make this report
failure?** The `/o` namespace check added in the same PR was verified to FAIL
on a planted violation before being committed, for exactly this reason.

## Superseded — hydrated 2026-09-13 (everything implemented is now reachable)

**Base branch @ `a8aabd2`. No open PRs. 349 tests, lint clean, build green,
typecheck clean, no drift.** PRs #32 and #33 merged since the last hydration.

**There is no longer an implemented service without a way in.** Every module
built since sprint 001 — ledger, periods, tenancy, reports — is reachable by a
person through the product.

| Surface | Route |
|---------|-------|
| Sign in / register | `/signin`, `/register` |
| Organizations | `/organizations` |
| Members, roles, ownership | `/{org}/members` |
| Chart of accounts | `/{org}/accounts` |
| Periods: open, close, lock, unlock | `/{org}/periods` |
| Post an entry | `/{org}/entries/new` |
| Journal, reversal | `/{org}/entries` |
| Trial balance, P&L, balance sheet | `/{org}/reports/...` |

Verified end to end with `curl` against a fresh build: post Cash 1000 / Sales
1000 and Rent 300 / Cash 300, and the P&L reports income 1000, expenses 300,
net 700, while the balance sheet reports retained earnings 700 — and refuses to
render at all if the identity fails.

### Where the UI is allowed to compute, and where it is not

Established across three PRs and worth stating once:

- **Totals always come from the report.** Subtracting two P&L totals in a
  component, or summing rendered rows, produces a number that agrees with the
  screen even when it disagrees with the ledger. I4 forbids it by name.
- **The balance sheet page STATES the accounting identity rather than checking
  it.** `balanceSheet` refuses to return a result where it fails, at exact
  Decimal equality, so recomputing in the UI could only produce a second
  opinion.
- **The posting form's running total is explicitly a convenience**, says so on
  screen, and does not gate submission. `je_balanced_check` at COMMIT decides.
- **Amounts leave the ledger as strings.** A `Prisma.Decimal` in a React tree
  invites `Number()`, which is what I8 forbids.

### Reports are URLs

The date controls are plain GET forms — no JavaScript, no client component.
`?from=…&to=…` is read by the page, so a report can be bookmarked, sent to an
accountant, and reopened next quarter, and the back button behaves. A
client-side picker would have cost all three.

### Two more near-misses, both caught by checking

- A footnote claiming drafts appear in the P&L. Both queries filter on
  `posted_at IS NOT NULL`. **Read the query rather than assuming the prose.**
- A period screen that offered "Close" on an already-closed period. Buttons are
  now derived from the period's current status: a control whose only outcome is
  an error teaches people to ignore refusals.

### The reason field on a period transition is mandatory

I3 requires an unlock to be recorded. The services write that row — but
"unlocked by admin@example.com" answers nothing an auditor asks. `L36` asserts
the reason **reaches the audit trail**, because if it did not, requiring it
would be ceremony.

## Superseded — hydrated 2026-09-13 (the accounting loop closes)

**Base branch @ `fda25d0`. No open PRs. 342 tests, lint clean, build green,
typecheck clean, no drift.** PR #30 merged since the last hydration.

**The double-entry loop is now complete through the product**: sign up →
organization → members → chart of accounts → post a balanced entry → see it in
the journal → reverse it → watch both appear in the trial balance. Nothing in
that path requires touching the database.

### The correction model, and why the UI labours the point

A reversal **does not undo anything**. I2 makes posted rows read-only at the
database level, so there is no edit path to write even if someone wanted one. A
reversal posts a second, opposite entry and both stay in the journal for ever.

The confirmation is two inline steps, not `window.confirm` — a browser dialog
blocks the page and cannot be tested — and the second step spells the
consequence out, because **someone expecting a delete and getting two entries
will conclude the product is broken**.

The reversal date defaults to TODAY rather than the original's date.
Back-dating a correction into the period being corrected would change a period
that may already have been reported on.

### Two different facts were sharing one error class

The reversal tests failed with 404. A reversal posts into whichever period
covers its date, and the fixture had only a 2024 period.

- *"That entry does not exist"* must stay opaque — it may be an attempt to
  reach another tenant's row.
- *"You have no period covering today"* is a gap in the caller's **own** books
  that only they can fix, and 404 sends them looking for a missing entry
  instead of at their period list.

`NoPeriodForDateError` → `LEDGER_NO_PERIOD_FOR_DATE` → 422. **The fixture was
masking the behaviour rather than testing it**, which is its own lesson: a
test setup that avoids a condition is not the same as one that covers it.

### The running tally of what execution found

Every defect this session came from running something, not from reading it:

| Round | Found by | What |
|-------|----------|------|
| HTTP layer | reading the diff aloud to a reviewer | email case-sensitivity — two accounts per address |
| adapter | reviewer, then `curl` | no body cap; `Response` throws on a 204 with a body |
| scaffold | `curl` against the built server | no `Cache-Control`; page CSP overwriting the API's |
| membership | the test suite | trigger froze ownerless organizations |
| posting | `curl` | a refused entry answered 500 |
| reversal | the test suite | 404 where the user needed 422 |

And one near-miss worth keeping: after fixing the 500, the live server still
returned 500 while the tests returned 422. The tempting explanation —
`instanceof` failing across Next's bundle chunks — would have sent me rewriting
every error check in the HTTP layer. It was a **stale `.next`**.

> **Verify the build is current before concluding anything from a running
> server.** A live check is only evidence about the code actually running.

## Superseded — hydrated 2026-09-13 (the ledger has a screen)

**Base branch @ `79f7da0`. No open PRs. 331 tests, lint clean, build green,
typecheck clean, no drift.** PRs #27 and #28 merged since the last hydration.

A person can now sign up, create an organization, invite colleagues, build a
chart of accounts, **post a balanced journal entry**, and watch it appear in the
trial balance — all through the product.

### Three things found by running it, not by reading it

**1. A refused entry answered 500 "internal error".** The refusal was right and
the status was wrong: `toErrorResponse` rethrows what it does not recognise, so
a `LedgerError` fell through to the adapter's catch-all. Now 422 with the
domain error's own message — "debits 500 do not equal credits 499".

**2. My first fix was at the wrong layer.** I matched Postgres constraint names
in the exception text, and it did not work: `postJournalEntry` already catches
the database error and rethrows a typed `LedgerError` with a stable `code`, so
the names never appear. **Key on the domain error, not on the constraint** — a
constraint can be renamed and a text match silently stops matching.

**3. I nearly concluded `instanceof` fails across Next's bundle chunks.** After
the fix, the live server still returned 500 while the tests returned 422. That
explanation was plausible and would have sent me rewriting every error check in
the HTTP layer. It was a **stale `.next`** — I had not rebuilt after the commit.

> **Verify the build is current before concluding anything from a running
> server.** A live check is only evidence about the code actually running.

### A gate caught its author for the second time

The "nobody imports the unguarded ledger services" grep rejected a **type-only**
import of `posting.ts` in the HTTP handler. No runtime bypass — but the gate
cannot distinguish `import type` from `import`, and should not try: a type-only
import today is one character away from a value import tomorrow.

Both times a gate has caught me this session, the right answer was to **move the
code, not relax the check**. `guarded.ts` is now the complete public surface of
the ledger module — the functions and the shapes they take.

### Where the line between UI and ledger is drawn

The posting form shows a running debit/credit total and **does not gate
submission on it**, and says so on screen. `je_balanced_check` is a `DEFERRABLE`
trigger evaluated at COMMIT, and that is the only point the question has a
trustworthy answer. A browser sum is a claim about what we intend to write.

The submit button stays enabled when the total is out, deliberately: a UI that
refuses to submit is a UI that can be wrong in a direction nobody can override.

Money is a **string** end to end — regex-validated in the handler, passed
untouched to `Prisma.Decimal`, totalled in the form as integer ten-thousandths.
`L17` posts `0.1 + 0.2 = 0.3` and reads the stored Decimals back.

## Superseded — hydrated 2026-09-13 (a person can use it)

**Base branch @ `967900e`. No open PRs. 312 tests, lint clean, build green,
typecheck clean, no drift.** PRs #24 and #25 merged since the last hydration.

### The whole flow works, verified with curl against the running server

```text
register                             201
signin                               200
create organization                  201
invite a second person as BOOKKEEPER 201
invite them as OWNER                 403  AUTH_OWNERSHIP_NOT_GRANTABLE
members page                         200  (form, invitee, transfer section)
trial balance                        200  ("No posted journal entries…")
an organization you are not in       404
the same page, signed out            307 → /signin
```

**Nobody has to touch the database any more.** That last pair is the
page/API asymmetry working: a PAGE sends a person to the sign-in form, an API
answers 404 so it confirms nothing about the slug.

### Two things the curl run found that reading would not have

1. **Sign-in ROTATES `__Host-csrf`.** The first attempt failed at "create
   organization" with a 403, because the token read from the sign-in page was
   already stale. The rotation is correct and stays — reissuing on a privilege
   change stops a token planted before authentication remaining valid after it
   — but it means any client caching the value at render time breaks on its
   first request afterwards. That is why `MemberAdmin` and `NewOrganization`
   read the cookie at CALL time, and `H29` now pins it so removing the rotation
   is a decision rather than a tidy-up.
2. The earlier 500 on a valid sign-in was **my own wrong `DATABASE_URL`**, not
   a defect — and it usefully confirmed the generic-500 path leaks nothing: the
   credentials error stayed in the server log, the body said "internal error".

**Running it beats reading it. Every round this session, the thing that found
the defect was execution.**

### Where the UI draws the line

The members page computes which controls to show from **the same permission
table the server enforces with**, not a second hand-written list that would
drift. That decides what is RENDERED and nothing else — every action behind
those controls is re-checked server-side, and `O9`, `O16` and `O19` cover the
forged-request case from the other side.

Members you cannot act on are **absent** rather than disabled. A disabled
control for an action you could never take is noise, and the table above lists
everyone anyway.

### Route slugs are a namespace, and collisions do not error

Organization slugs occupy the first URL segment. Next resolves a static segment
before a dynamic one, so a slug colliding with a real route does not break the
route — it makes the ORGANIZATION permanently and **silently** unreachable.
Someone picks `members` as their address and every link into their own books
answers with somebody else's endpoint, with nothing erroring anywhere.

`20260913000000_reserve_route_slugs` reserves the names in use plus a handful
in advance, because adding a route later cannot retroactively rename an
organization that already holds the name.

## Superseded — hydrated 2026-09-12 (tenancy administration is real)

**Base branch @ `b56ef09`. No open PRs. 291 tests, lint clean, build green,
typecheck clean, no drift.** PRs #21 and #22 merged since the last hydration.

Organizations, memberships, role changes, removal and ownership transfer are
all service operations with tests, and every one of them writes an audit row in
the same transaction as the change.

### The authorization rule, and the two wrong answers it is not

A granter may assign a role **strictly below their own**, and **OWNER never
through `role.grant` at all**.

- **"You may not target yourself" is insufficient.** Two ADMINs escalate each
  other — A promotes B, B promotes A — and neither ever targets themselves.
  `M8`.
- **"At or below" is insufficient.** An ADMIN who can mint another ADMIN can
  mint an accomplice with every power they hold, which makes the boundary
  unenforceable by headcount. `M7`.
- **And the half that is easy to miss:** an ADMIN must not be able to reach UP
  and DEMOTE an OWNER. Same takeover, faster route. `M9`.

"At least one OWNER" is a `DEFERRABLE` trigger, not a service count. A
check-then-act races: two concurrent demotions each read two owners, each
conclude they are safe, and the organization ends with none.

### Three of my own claims were wrong this round

Recorded because the pattern is more useful than the individual corrections:

| Claim | What was actually true |
|-------|------------------------|
| The trigger should refuse whenever the owner count is zero | Wrong question. An org that NEVER had an owner became frozen — its memberships could never be removed. Only removing or demoting an OWNER can take the count to zero. Four unrelated tests caught it |
| `M3`: slug `"UPPER"` should be rejected | `createOrganization` lowercases before inserting, so it is a valid slug written loudly. The test was wrong about the service it tested |
| `B-20260912-04` needs a schema decision | `audit_logs.entity_type` is a plain `String`. `"Membership"` fit with no migration. The obstacle was imagined and filing it cost a round trip |

**All three were caught by running things, not by re-reading them.** The trigger
by the suite, the slug by the suite, the audit schema by opening the model.

### The running ledger of checks that could not fail

Now at five, plus one that worked:

1. CI grep for `posting.js` — would have matched nothing after the extension removal
2. `sophia_review` — returned `FINDINGS: NONE` about a different repository
3. `await expect(() => syncFn()).toThrow()` — the `await` did nothing and hid that the assertion is vacuous on a rejection
4. A test mock hardcoding `"__Host-session"` — a rename would send every test down the "no session" path and still pass four of seven
5. **The framework-import gate — worked, and caught its own author**

### The judge, after five rounds

**Its first answers have been right every time. Its follow-ups contradict them
twice out of five.** It chose the page-embedded CSRF token and then described
the rejected option as the mechanism; it chose a minimal type-aware lint set and
then named its own two critical rules as the ones to disable.

Both contradictions were caught by reading the answer against itself, and the
second was resolvable without re-asking. Its call on the escalation rule (option
B, strictly-below plus OWNER excluded) held up completely and shaped the whole
of `membership.ts`.

**Working rule: take the verdict, interrogate the elaboration, never let the
elaboration overwrite the decision it was meant to explain.**

## Superseded — hydrated 2026-09-12 (a screen shows real ledger data)

**Base branch @ `cca2913`. No open PRs. 258 tests, lint clean, build green,
typecheck clean, no drift.** PRs #18 and #19 merged since the last hydration.

The chain now runs end to end through a rendered page: cookie →
`resolveScopeFromSession` → membership re-resolved → `assertCanDo` →
`guardedTrialBalance` → posted ledger rows summed in SQL → a table.

`src/server/next/page-scope.ts` is to rendering what `guarded.ts` is to the
service layer: the only place a page obtains a scope. All four authorization
failures collapse to `notFound()`, never 403, because a 403 confirms the
organization exists and makes the URL bar an enumeration oracle over the
customer list.

### A gate caught its own author, one commit after a different gate almost didn't

`page-scope.ts` was written into `src/server/http/` — the layer defined as
importing no framework — and it imports `next/headers`. CI refused the PR.

The cheap fix was to relax the gate. The right one was to move the file, which
is what happened: `src/server/next/` now exists to make framework-coupled
server code recognisable, and the CI gate gained the converse assertion that
**only** that directory and `src/app/` may import `next/*`. Without the second
half, the next file reaching for `next/headers` lands wherever is convenient
and the directory stops meaning anything.

That is the fourth and fifth entry in the same ledger of vacuous-or-nearly
checks:

| # | The check | What was wrong |
|---|-----------|----------------|
| 1 | CI grep for `posting.js` | would have matched nothing after the extension removal, passing silently |
| 2 | `sophia_review` | returned `FINDINGS: NONE` about a different repository |
| 3 | `await expect(() => syncFn()).toThrow()` | the `await` did nothing and hid that the assertion is vacuous on a rejected promise |
| 4 | a test mock hardcoding `"__Host-session"` | a rename would leave it matching nothing, sending every test down the "no session" path — and still passing four of seven |
| 5 | the framework-import gate | **worked**, and caught the author |

**The question to ask of any new gate: what input would make this report
failure?** If the answer is not immediate, the gate is decoration.

### And I wrote a flaky test

`P8` asserted `verifyAgainstDummy`'s memoisation by wall clock — second call
must not be much slower than the first. It failed at **1924ms against a 558ms
bound** on a loaded machine.

A suite that fails for reasons unrelated to the change is worse than one that
does not test the thing: it teaches people to re-run CI instead of reading it.
The memoisation is real and visible in the source; a stopwatch cannot assert it
reliably here. `P8` now asserts what a test can hold — never throws, never
true, any input.

### Merging now needs `gh pr update-branch` first

The rulesets use `strict_required_status_checks_policy`, so a PR whose base has
moved is refused with a suggestion to use `--admin`. **Do not.** That bypasses
required checks, which `git-collaboration.md` forbids outright. `gh pr
update-branch <n>`, wait for the re-run, then merge.

## Superseded — hydrated 2026-09-12 (sign-in works, lint gate is real)

**Base branch @ `bb81231`. No open PRs. 251 tests, lint clean, `pnpm build`
green, typecheck clean, no migration drift.** PRs #15 and #16 merged since the
last hydration.

### A user can now sign in, verified against the running server

```text
$ curl -i http://127.0.0.1:4011/signin
set-cookie: __Host-csrf=IHw1Mt0ssR…; Path=/; Max-Age=3600; Secure; SameSite=lax
   …same value embedded in the HTML as csrfToken":"IHw1Mt0ssR…

POST /api/auth/signin  matched pair          → 200, sets __Host-session
POST /api/auth/signin  cookie, no header     → 403 CSRF_INVALID
POST /api/auth/signin  pair, wrong password  → 401
```

`B-20260912-01` is closed. `src/middleware.ts` commits the CSRF cookie on the
sign-in PAGE and hands the same value to the renderer via a request header,
which breaks the circularity that made sign-in uncheckable. Middleware and not
the page itself because a Next 15 server component cannot call `cookies().set()`
during render — it throws.

### I recorded that blocker as more severe than it was

Worth carrying forward, because the correction came from pushing back rather
than from building. **`SameSite=Lax` does not send cookies on a cross-site POST
at all.** A forged sign-in therefore arrived with no cookie and was already
being refused. Login CSRF was mitigated by the cookie attributes; the blocker
said it was open.

The token is still worth having, for narrower reasons stated in the entry: it
covers clients that do not implement `SameSite`, and it fails closed if the
cookie attributes are ever loosened — a future `SameSite=None` for an embedding
partner would otherwise reopen the hole with nothing left to catch it.

### The judge contradicts itself on follow-up questions — twice now

A pattern, not an incident, and it changes how to use it:

| Round | First answer | The contradiction |
|-------|--------------|-------------------|
| CSRF mechanism | chose **(B)** page-embedded token | then described **(A)**, the option it had just rejected, as the mechanism |
| Lint ruleset | chose **(C)** minimal type-aware | then listed `no-floating-promises` and `no-misused-promises` as the rules to disable — the two it had just called critical |

**Its initial recommendations have held up. Its elaborations do not.** Both
contradictions were caught by reading the answer against itself. The second was
resolvable without re-asking: both rules have config options rather than needing
to be off.

So: take the verdict, interrogate the reasoning, and never let an elaboration
silently overwrite the decision it was supposed to explain.

### The lint gate found one thing worth the whole exercise

**Zero findings in `src/`** — no floating promises in production code, which is
what the type-aware rules were turned on to confirm. Eleven in tests. Three of
them were this:

```ts
await expect(() => assertCanDo(scope, "ledger.post")).toThrow(ForbiddenError);
```

The synchronous `.toThrow()` returns `void`, so the `await` did nothing — and
made the assertion LOOK as though it would catch a rejection if `assertCanDo`
ever became async. It would not: `expect(() => asyncFn()).toThrow()` passes
**vacuously** on a rejected promise. That is the third vacuous-check found in
this session, after the CI grep matching `posting.js` and the `sophia_review`
that returned `FINDINGS: NONE` about another repository.

**Three in one session is a category, not a coincidence.** A check that cannot
fail looks exactly like a check that passes. Worth asking of any new gate: what
input would make this report failure?

## Superseded — hydrated 2026-09-12 (the application is reachable)

**Base branch @ `6a939e4`. No open PRs. 240 tests green, `pnpm build` green,
typecheck clean, no migration drift.** Three PRs merged this round: #11, #12,
#13.

**The gap that has been open since sprint 001 is closed.** `next build`
produces four working auth endpoints, each one line of routing:

```
├ ƒ /api/auth/register
├ ƒ /api/auth/session
├ ƒ /api/auth/signin
└ ƒ /api/auth/signout
```

All four `ƒ` (dynamic) — a statically rendered auth response would hand the
next visitor somebody else's session.

### The habit that is paying: check the claim against the running thing

Three rounds, three reviews, four real defects — and in the last round the
review was also **wrong about one thing**, which matters as much:

| Claim | Verdict | How settled |
|-------|---------|-------------|
| Email lookup case-sensitive while the rate-limit key is lowercased | REAL | read the code; two accounts for one address |
| No request-body size cap | REAL | `A18`/`A19` |
| `Response` throws on a 204 with a body | REAL | `A22` |
| API responses carry no `Cache-Control` | REAL | `curl` against the built server |
| Page CSP overwrites the API's stricter one | REAL | `curl`: `default-src 'self'` where the handler set `'none'` |
| `source: "/:path*"` misses the root path | **WRONG** | `curl /` — headers were there all along |

A review is evidence to test, not a verdict to apply. Two minutes of `curl`
separated four real findings from one confident mistake.

### And a decision document was wrong too

ADR-0002 chose `bundler` module resolution, then asserted the `.js` import
suffixes could stay because `bundler` maps `./y.js` to `y.ts`. **True of
TypeScript, false of the bundler.** `tsc --noEmit` passed clean and
`next build` could not resolve a single route file.

`moduleResolution: "bundler"` tells the TYPE CHECKER to behave as a bundler
would. It does not configure webpack, and webpack looks for `web.js`, which
does not exist. 158 suffixes came out across 35 files.

Two lessons, both now load-bearing:

1. **`pnpm build` is a CI gate in its own right.** The typecheck and the build
   answer different questions; this is the proof.
2. **A CI grep can pass vacuously.** The gate checking that nobody imports the
   unguarded ledger services was matching `posting.js`. After the rename it
   would have matched nothing and reported success. Any grep-based gate needs
   a reason to believe its pattern still matches something.

### State by layer

**Base branch @ `6fc4c1b`. No open PRs. 231 tests green**, typecheck clean, no
migration drift — verified on the Sophia pod against a real PostgreSQL 14 and
again in CI against a `postgres:14` service container.

Two PRs merged this round:

- **#11** (`f1505e3`) — the framework-agnostic HTTP layer: `types.ts`,
  `cookies.ts`, `csrf.ts`, `handlers/auth.ts`, plus sliding session renewal and
  the `sessions.created_at` migration. 209 tests.
- **#12** (`6fc4c1b`) — `adapters/web.ts`, the one file that knows `Request` and
  `Response` exist, plus a 64 KiB request-body cap and a null-body-status
  guard. 231 tests.

### Each round, review found something the tests did not

Worth recording as a pattern rather than two anecdotes, because both defects
were invisible to a green suite:

- **#11** — `enforce` lowercased the email for its rate-limit key while `signIn`
  looked the user up by the raw string. `users.email` is `UNIQUE` on the raw
  string, so `Admin@corp.com` and `admin@corp.com` were two separate accounts.
  206 tests passed over it.
- **#12** — no request-body size cap (`request.json()` buffers a gigabyte before
  anything can refuse it), and `new Response(body, { status: 204 })` *throws*
  rather than ignoring the body, so a handler returning a 204 with a body would
  have produced a 500 three layers from the cause.

The common shape: both are about what happens on inputs the tests never thought
to send. Tests encode the cases someone imagined. Review is for the rest.

### The chain now reaches HTTP

`HttpRequest` → `signInHandler` → `signIn` → session row storing only a sha256
of the token → `__Host-session` cookie → `sessionHandler` → `resolveSession` +
`touchSession` → `resolveOrgScope` (membership re-checked per request) →
`assertCanDo` → `guarded.ts` → ledger services → database invariants.

…and `toRouteHandler` wraps the last step, so a Next.js route handler is one
line: `export const POST = toRouteHandler(signInHandler())`.

**What is still missing is a socket.** The handlers and the adapter exist and
are tested; no Next.js scaffold serves them, so no endpoint is reachable by a
browser. That is now the single thing standing between tested modules and an
application, and it is the next task.

**The known friction, recorded before hitting it:** `next dev` / `next build`
rewrites `tsconfig.json` — it sets `moduleResolution: "bundler"`, `module:
"esnext"`, `jsx: "preserve"`, `noEmit`, and adds its plugin. The current config
is `module: "NodeNext"`, which is what makes the `.js`-suffixed relative
imports and the `tsx`/Vitest side work. Expect to need either two tsconfigs or
a deliberate decision about which resolution mode the whole repository uses.
Do not let Next silently rewrite the file and discover it in a diff.

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

### Landed this round (#11, #12)

- **HTTP layer** — plain object in, plain object out, no framework import,
  enforced by a CI grep.
- **Adapter** — `toHttpRequest` / `toResponse` / `toRouteHandler`. Narrows the
  method rather than casting it (an invented verb reaching `isMutating` would
  answer "not mutating" and skip CSRF while carrying the session cookie).
  Appends `Set-Cookie` rather than setting it (collapsing sign-in's two cookies
  would leave a user with a session and no CSRF token). Caps the body at 64 KiB,
  counted over bytes received rather than over `content-length`, which is
  optional, absent on chunked requests, and freely understated by the client.
- **`x-forwarded-for` is NOT believed by default.** The rate limiter keys its
  per-address counter on it, so trusting a client-set header gives an attacker a
  fresh counter per request. `A17` pins the honest cost of the default: without
  a trusted proxy the address dimension contributes nothing, and the account
  dimension is what still works.
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
| HTTP layer security (209 tests) | **1 real defect found** | email case; fixed in-branch, PR #11 |
| Web adapter security (231 tests) | **2 real defects found** | body cap, 204 body; fixed in-branch, PR #12 |

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

The feature backlog is no longer the constraint — **everything implemented is
reachable.** What remains is debt, hardening and the things a real user would
ask for on day one.

1. **`B-20260911-04` — Row Level Security.** Tenant isolation rests on
   application filtering plus the `jl_org_consistency` trigger. Every one of
   the ~25 tenancy tests passes, and none of them would catch a query written
   next month that forgets its `organizationId`.
2. **No audit trail is readable through the product.** Rows are written for
   post, reverse, lock, unlock, membership and ownership changes, and the only
   way to read them is SQL. For an accounting product that is the report an
   auditor asks for first.
3. **No export.** No CSV, no PDF, on any report. An accountant asks on first
   contact.
4. **No drill-down.** You cannot click an account in a report to see the
   entries behind the figure, which is the first thing anyone does when a
   number looks wrong.
5. **The journal has no pagination or filtering** — 100 most recent. Wrong at
   the first real month-end.
6. **A reversal cannot be given a reason**, and writes no `audit_logs` row.
   I9 lists "reverse" explicitly.
7. **No app shell.** The home page is static so it cannot know whether a
   visitor is signed in.
8. **`audit_logs.request_id` is null everywhere.**
9. **Rate limiting covers only sign-in and sign-up.**
10. **No component tests.** No jsdom setup; every screen is covered on the
    server side and not in the rendering.
11. **Prettier**, or a decision not to have one.
12. `B-20260912-03` — decide how `prisma migrate diff --exit-code` should treat
   database objects Prisma cannot model, then add the `lower(email)` unique
   index. The same question already applies to every trigger in the init
   migration, so the answer is worth writing down once.
13. `B-20260911-04` — ARCHITECT decides on RLS.
14. `B-20260911-07` / `-08` — the reaper job, and something that actually reads
   `security_events`. A security log nobody reads is a log that exists for the
   auditor and not for us. Run the reaper under `tsx`, not plain `node`:
   ADR-0002 removed the extension suffixes plain Node ESM would need.
15. Then SALES-AR: the first module that posts *through* the ledger.

## Superseded — hydrated 2026-09-12 (HTTP layer and adapter merged)

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

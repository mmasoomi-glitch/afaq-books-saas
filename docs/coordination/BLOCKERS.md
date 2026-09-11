# docs/coordination/BLOCKERS.md

Living list of blockers, handoffs and "I can't finish my task because…"
entries. Every agent appends here when needed. GITKEEPER curates and
resolves.

## How to file

Append a new section at the bottom using this template:

```markdown
### B-YYYYMMDD-NN — <short title>

- **Filed by:** <agent slug>
- **Date:** YYYY-MM-DD
- **Branch:** <agent branch>
- **Status:** open | acknowledged | granted | resolved | rejected
- **Type:** blocker | handoff request | schema proposal | clarification

**What I need**

<concrete description>

**Why this is needed**

<concrete description tying it to a sprint-board task>

**What I tried**

<concrete description, including commands and outputs if relevant>

**Asks**

- <agent owner>: please <action>
- GITKEEPER: please <action>
```

Numbering: `B-YYYYMMDD-NN` where NN is sequential within that date.

---

## Open

### B-20260527-01 — Branch protection on `main` and `develop` is not configured

- **Filed by:** Lead Orchestrator
- **Date:** 2026-05-27
- **Last updated:** 2026-09-11 (**resolved** — see "Resolution" at the end of this entry)
- **Branch:** `chore/agent-governance-bootstrap`
- **Status:** resolved
- **Type:** blocker (release-readiness) — but **not** a blocker on the bootstrap PR merge

**What I need**

The repository owner (already authenticated) to either:

(a) authorize me to configure protection via `gh api` using the JSON
in `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, **after** the bootstrap PR
has been manually merged to `develop`; or

(b) configure it themselves in the GitHub UI per that document, also
after the bootstrap PR has been merged.

Both must be done **before** sprint 001 worker branches are launched.

**Why this is needed**

Hooks and CLAUDE.md are *local* controls. They can be bypassed by a
user with write access or by tooling that doesn't load this repo's
Claude settings. Without server-side rulesets, the guarantee "no one
pushes directly to `develop` or `main`" is not enforceable.

**Update — single-owner correction (2026-05-27)**

The original plan in this file's `GITHUB_BRANCH_PROTECTION_REQUIRED.md`
proposed `required_approving_review_count = 2` on `main` and `= 1` on
`develop`, with `enforce_admins = true`. The user (single owner)
correctly pointed out that this would lock the repo: the same identity
that opens a PR cannot approve it. The revised plan in that document
removes required approvals entirely for the single-owner phase, keeps
"require PR + status checks + block force-push + block deletion", and
documents the upgrade path when a second trusted reviewer joins.

The revised plan also **defers** protection configuration until after
the bootstrap PR is manually merged, so the bootstrap PR itself is
not blocked by a require-PR rule it cannot satisfy (the workflow run
needs to land on `develop` first).

**What I tried**

- `gh api repos/.../rulesets` → `[]`
- `gh api repos/.../branches/main/protection` → 404
- `gh api repos/.../branches/develop/protection` → 404

No protection exists. Authenticated session (`mmasoomi-glitch`) has
`admin:true`, so the configuration calls are runnable on user
authorization.

**Asks**

- Repository owner: review the revised plan in
  `GITHUB_BRANCH_PROTECTION_REQUIRED.md`, then either (a) authorize
  the lead session to apply rulesets via `gh api`, or (b) apply
  rulesets in the GitHub UI.
- Action must happen **after** the bootstrap PR merges and **before**
  sprint 001 starts.
- GITKEEPER: track this until resolved; do not approve the sprint 001
  integration PR until rulesets are confirmed live via API.

**Resolution — 2026-09-11**

The repository owner authorized the lead session to apply the revised
single-owner plan. Both rulesets were created and then **verified via
the resolved-rules endpoint**, not assumed from the POST response:

```text
$ gh api .../rulesets --jq '.[] | {name, enforcement, target}'
{"enforcement":"active","name":"protect-develop","target":"branch"}
{"enforcement":"active","name":"protect-main","target":"branch"}

$ gh api .../rules/branches/develop --jq '[.[] | .type] | sort'
["deletion","non_fast_forward","pull_request","required_status_checks"]

$ gh api .../rules/branches/main --jq '[.[] | .type] | sort'
["deletion","non_fast_forward","pull_request","required_status_checks"]

$ gh api .../rules/branches/develop --jq \
    '.[] | select(.type=="required_status_checks")
         | .parameters.required_status_checks[].context'
Hook scripts parse cleanly
Hook scripts block what they should
Governance documents exist
YAML files parse
gitleaks (no secrets in diff)
```

Ruleset ids: `protect-develop` = 22882053, `protect-main` = 22882054.
Recorded in `INTEGRATION_LOG.md` under 2026-09-11.

**Consequence for every agent:** the five check names above are now
load-bearing. Renaming a job in `governance-checks.yml` silently
un-enforces that gate, because the ruleset matches on the name string.
Add jobs; do not rename these five without updating both rulesets in
the same change.

---

### B-20260911-01 — Ownership hook does not gate `Write`/`Edit`, and does not know about `src/modules/**`

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Branch:** `chore/intention-contract-sprint-001`
- **Status:** **resolved 2026-09-11** — PR #4 merged. The hook now handles
  `Write`/`Edit`/`NotebookEdit`/`MultiEdit` via a second matcher, carries 44
  ownership rules resolved longest-prefix-first including `src/modules/**`,
  parses Bash by shell operator and command name rather than substring, and
  matches owners by exact token. 35 local cases and 8 CI cases, all passing.
  Two follow-on defects were found and fixed during review: redirection targets
  after a space were never captured (`echo x > file` matched the empty string),
  and the pure-read filter discarded redirection targets so `cat x > protected`
  was allowed.
- **Type:** blocker (governance correctness)

**What I need**

PLATFORM-GUARDIAN to close three gaps in
`.claude/hooks/check-agent-ownership.sh` and `.claude/settings.json`.

**Why this is needed**

`OWNERSHIP.md` is the repository's central conflict-prevention
mechanism, and it is currently close to unenforced:

1. **`Write`/`Edit` are never checked.** `.claude/settings.json`
   registers both hooks under a single `"matcher": "Bash"`. An agent
   editing a file the normal way — with the `Write` or `Edit` tool —
   never reaches the ownership hook at all. Only shell redirections
   are inspected.
2. **`src/modules/**` is not in `protected_globs`**
   (`check-agent-ownership.sh:44-58`). Module boundaries — the whole
   point of the twelve-agent split — are not represented, so even the
   Bash path would not catch SALES-AR writing into
   `src/modules/ledger/`.
3. **Write-detection is a lowercased substring scan**
   (`check-agent-ownership.sh:84-91`). It false-positives on reads
   that merely redirect (`cat prisma/schema.prisma > /tmp/x`) and
   false-negatives on any write that does not contain one of eight
   literal markers (a Python or Node one-liner, `python -c
   "open(...,'w')"`, `install`, `truncate`).

A fourth, smaller issue: owner matching uses a substring test
(`:103`), so a future agent slug that is a prefix of another would
match the wrong row.

**What I tried**

Read both files in full and confirmed the matcher and the glob list.
The CI functional tests in `governance-checks.yml` pass — but they
only exercise the Bash path, so they do not detect gap (1) or (2).

**Asks**

- PLATFORM-GUARDIAN: add `Write|Edit|NotebookEdit` matchers reading
  `tool_input.file_path`; add `src/modules/**`, `src/server/**`,
  `src/ui/**`, `tests/**` to the ownership map; replace the substring
  write-heuristic with explicit path extraction; make owner matching
  exact-token.
- QA-AUDITOR: add CI cases covering a `Write`-tool call and a
  cross-module `src/modules/**` write, so the gaps cannot silently
  reopen.

---

### B-20260911-02 — Ledger `organization_id` has no foreign key until AUTH-TENANCY lands

- **Filed by:** Lead Orchestrator (on behalf of LEDGER-CORE)
- **Date:** 2026-09-11
- **Branch:** `agent/04-ledger-core-sprint-001`
- **Status:** **resolved 2026-09-11** — PR #5 merged. Migration
  `20260911151052_add_tenancy_and_ledger_fks` adds a foreign key from every one
  of the eight ledger tables to `organizations(id)` `ON DELETE RESTRICT`.
  RESTRICT, not CASCADE: deleting an organization must never silently delete its
  posted ledger. Test S20 asserts the closure directly — inserting an account
  under an organization that does not exist is now rejected, where before it
  succeeded. The generated migration came back with `NOT VALID` appended, which
  was removed: that enforces new rows but leaves existing rows unchecked.
- **Type:** schema proposal / handoff request → AUTH-TENANCY

**What I need**

AUTH-TENANCY to add foreign keys from every ledger table's
`organization_id` to `Organization(id)` as part of its sprint, and to
treat that migration as a **required exit criterion**, not optional
cleanup.

**Why this is needed**

The repository owner directed a ledger-first ordering on 2026-09-11,
and directed that ledger tables carry `organization_id` as a plain
`uuid NOT NULL` column with no FK, rather than importing a stub
`Organization` model into AUTH-TENANCY's schema section.

The consequence, stated plainly: accounting invariant **I7** is
enforced at the column and service layer only. The database will
accept an `organization_id` that names no real organization. Nothing
detects an orphaned or fabricated tenant id until the FK exists.

Mitigations already committed to in `INTENTION_CONTRACT.md` C3:

- `organization_id` is `uuid NOT NULL`, no default, on all ledger
  tables (C3.1).
- Every composite unique/index leads with `organization_id` (C3.2).
- A database `CHECK` asserts a journal entry and its lines' accounts
  share the same `organization_id`, so cross-tenant *mixing within
  the ledger* is impossible even without the FK (C3.3).

These reduce the blast radius. They do not replace referential
integrity.

**Asks**

- AUTH-TENANCY: on landing `Organization`, author the migration
  adding `FOREIGN KEY (organization_id) REFERENCES "Organization"(id)`
  to `Account`, `Period`, `PeriodLock`, `JournalEntry`,
  `AccountingConfig`, `JournalCounter` and `AuditLog`, plus a
  data-integrity check for pre-existing orphans.
- LEDGER-CORE: review that migration (ledger tables, so review is
  mandatory regardless of author).
- GITKEEPER: do not close this blocker until the FKs are live in a
  merged migration.

---

### B-20260911-03 — `main` is 11 commits behind `develop` and is the repository's default branch

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Branch:** n/a
- **Status:** open
- **Type:** clarification / owner decision

**What I need**

A decision from the repository owner on whether `main` should be
brought up to date with `develop`, and whether `develop` should
become the default branch.

**Why this is needed**

`origin/main` is still at `3a91656` — the empty-repo root commit
carrying only a README. `origin/develop` is at `438bb59` with the
entire governance bootstrap. `main` is the repo's **default** branch
and the repository is **public**, so anyone who clones or browses it
sees an empty project and none of the governance that defines how
this codebase is built.

This is not itself dangerous — no false financial claim is being made
— but it misrepresents the project's state to any reader, which sits
uncomfortably next to the truthfulness rules in `CLAUDE.md`.

**What I tried**

```text
$ git rev-parse --short origin/main origin/develop
3a91656
438bb59
$ git log --oneline origin/main..origin/develop | wc -l
11
$ gh api repos/mmasoomi-glitch/afaq-books-saas --jq .default_branch
main
```

**Asks**

- Repository owner: choose one — (a) open a PR `develop → main` to
  promote the governance bootstrap, (b) switch the default branch to
  `develop` and keep `main` for released versions only, or (c)
  document deliberately that `main` stays empty until first release.
- Note that `protect-main` now requires a PR plus the five status
  checks for any change to `main`, so option (a) is a normal PR, not
  a direct push.

---

### B-20260911-04 — No Row Level Security; tenant isolation is application-level only

- **Filed by:** Lead Orchestrator, on a finding by the independent judge
- **Date:** 2026-09-11
- **Status:** open
- **Type:** blocker (defence in depth) — deferred, not dismissed

**What I need**

ARCHITECT to decide whether Postgres Row Level Security lands in sprint 002,
and if so to write the ADR.

**Why this is needed**

`ADR-0001` already called RLS "strongly preferred" as a second line of defence
and left the sprint decision open. Today tenant isolation rests on two things:
every query filtering `organization_id` in application code, and the
`jl_org_consistency` trigger that forces a journal line's organization to match
both its entry and its account.

That is genuinely layered, and the reports additionally filter the organization
on all three joined tables. But it is still application-level. A single query
written without the filter — by a future module, a maintenance script, or a
report — leaks a tenant. RLS would make the database refuse regardless.

**Judge's assessment, recorded verbatim**

> "Deferring RLS is acceptable as the existing org-consistency trigger and
> application-level filtering provide robust isolation, making it a safe
> reversible follow-up."

So this is an accepted deferral with a recorded rationale, not an oversight.
It is not an acceptable permanent state.

**Asks**

- ARCHITECT: decide sprint 002 or later; write the ADR either way.
- Whoever implements it: the application sets `SET LOCAL app.current_organization`
  at the start of every transaction and policies filter on it. `withTx` is the
  single place that would need to change.

---

### B-20260911-05 — Nothing mechanically forces callers through the authorization gate

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Status:** **resolved 2026-09-11** — PR #10. `LedgerScope` now carries a
  phantom `unique symbol` brand, so a plain `{ userId, organizationId }`
  literal is no longer assignable and an accidental bypass is a COMPILE ERROR.
  `unsafeCreateLedgerScope` is the only constructor, named to be conspicuous,
  and CI asserts that only `src/server/auth/scope.ts` calls it and that only
  `guarded.ts` imports the unguarded services.

  **The honest limit:** a type cannot stop a determined caller, who can still
  call `unsafeCreateLedgerScope` themselves. What changed is that doing so is
  now impossible by accident and impossible to hide in review. The judge had
  required this before the HTTP layer: *"Structural branded scope type required
  to prevent silent bypass."*
- **Type:** blocker (security hardening)

**What I need**

A mechanism that makes bypassing `guarded.ts` fail rather than merely being
against convention.

**Why this is needed**

`src/modules/ledger/guarded.ts` and `src/modules/reports/guarded.ts` assert the
permission and then delegate. Every caller inside `src/` goes through them today
— verified by grep. But the underlying services remain exported, and nothing at
the type level, the lint level or in CI stops a future module from importing
`postJournalEntry` or `trialBalance` directly and skipping the check entirely.

The judge accepted this for the current stage: "application-level gating is the
current architectural standard, and enforcing it via code review is sufficient
for this stage." Code review is a person, and people merge things at 2am.

**Options, roughly in order of strength**

1. Make the unguarded services take a branded type that only `guarded.ts` can
   construct. Bypassing then fails to compile.
2. An ESLint `no-restricted-imports` rule scoped so only `guarded.ts` may import
   the service modules.
3. A CI grep asserting no file outside `guarded.ts` imports them — cheapest, and
   the same shape as the existing invariant grep in `ledger-ci.yml`.

**Asks**

- ARCHITECT: choose the mechanism.
- PLATFORM-GUARDIAN: implement it and add the CI check.

---

### B-20260911-06 — No rate limiting on sign-in, sign-up or password reset

- **Filed by:** Lead Orchestrator, on the independent judge's verdict
- **Date:** 2026-09-11
- **Status:** **resolved 2026-09-11** — PR #9 merged. Postgres-backed fixed
  window on both source address and account, progressive delay capped at 10s
  rather than a lockout, failing open. 16 tests. Judge's verdict on the
  implementation: *"Merge. The implementation correctly interprets the spec
  (progressive delay, not hard lock) and the atomicity strategy is sound."*
  Operational gaps split out as `B-20260911-07` and `B-20260911-08`.
- **Type:** blocker — **hard precondition on the HTTP layer**

**What I need**

The owner to choose a rate-limiting strategy, and PLATFORM-GUARDIAN or
AUTH-TENANCY to implement it, **before any HTTP surface exists**.

**Judge's verdict, recorded verbatim**

> "Rate limiting strategy and implementation for sign-in/sign-up/reset ||
> MEANWHILE: Implement the rate limiter and integrate it into the auth
> endpoints before enabling the HTTP layer."

**Why this is needed**

`.claude/rules/security-tenancy.md` requires sign-in, sign-up and
password-reset to be rate limited. The session layer merged in PR #7
implements none of it.

What exists is not a substitute. argon2id at the pinned parameters costs
roughly 19 MiB and a few tens of milliseconds per attempt, which raises the
price of guessing but does not cap it. The dummy-verify timing defence
addresses a different attack entirely — it stops an attacker learning *which
addresses are registered*; it does nothing against someone who simply tries
many passwords against one address.

Registration compounds it: `registerUser` must tell a caller their email is
already taken, so it is an account-enumeration oracle by design. That is
acceptable only when paired with rate limiting and email confirmation, and
neither exists.

**Why it does not block the merge of PR #7**

Nothing is deployed. There is no HTTP surface, no cookie handling, no route
that an attacker could reach. The judge's condition is explicitly scoped to
"before enabling the HTTP layer", and that is when this must be satisfied.

**Asks**

- Repository owner: choose the strategy. The realistic options are a fixed
  window or token bucket in Postgres (no new infrastructure, adequate at this
  scale), or Redis (better under load, new operational dependency).
- Whoever implements it: limit per source address AND per account, because
  those defend against different attacks — spraying many accounts from one
  address, versus grinding one account from many addresses.
- Record failed attempts in the security audit trail, which
  `security-tenancy.md` already requires.
- GITKEEPER: do not approve any pull request that introduces an HTTP route to
  the auth surface until this is closed.

---


### B-20260911-07 — The rate-limit reaper has no scheduler, and a blocked caller holds a task

- **Filed by:** Lead Orchestrator, from the judge's follow-up list on PR #9
- **Date:** 2026-09-11
- **Status:** open
- **Type:** blocker (operational) — **revisit with the HTTP layer**

**Two related problems, both harmless today and neither harmless later.**

**1. `reapExpired()` exists and nothing calls it.** Every distinct
`action:dimension:value` creates a row, and rows outlive their window. Under
sustained traffic — or a deliberate flood of distinct values — `rate_limits`
grows without bound. Today nothing drives traffic, so nothing grows. The moment
an HTTP layer exists, this is a table that only ever gets bigger.

Needs a scheduled job. A Postgres `pg_cron` entry, a platform scheduler, or a
call on a sampled fraction of requests would all work; the decision belongs with
whoever picks the deployment target.

**2. A blocked caller occupies a server task for up to 10 seconds.**
`enforce` awaits the delay and then throws, deliberately, so that a hostile
client cannot decline to wait. With no HTTP layer that costs nothing. Under a
real server, many simultaneously-blocked attackers hold many tasks, which is a
resource-exhaustion vector — the throttle becomes the load.

Mitigations to weigh when the HTTP layer lands: cap concurrent delayed requests;
return `429` with `Retry-After` immediately once the delay would exceed some
threshold, accepting that a hostile client ignores it while an honest one does
not; or move the wait to a queue. This is a genuine trade-off, not an oversight
— the current choice favours correctness against a hostile client over
resilience against a flood.

**Asks**

- PLATFORM-GUARDIAN: schedule the reaper once a deployment target exists.
- ARCHITECT: decide the delay strategy before the first HTTP route ships.

---

### B-20260911-08 — Nothing watches `security_events`

- **Filed by:** Lead Orchestrator, from the judge's follow-up list on PR #9
- **Date:** 2026-09-11
- **Status:** open
- **Type:** blocker (security monitoring)

`auth.signin.failed`, `auth.signin.succeeded` and `auth.signup.duplicate` rows
accumulate in an append-only table and **nothing reads them**. A record nobody
looks at is not detection; it is only evidence after the fact.

`security-tenancy.md` requires sign-in failures to be logged "with rate-limit
context", which is now satisfied, but logging was never the point on its own.

What would make it real: an alert on a spike in `auth.signin.failed` for one
account (someone is grinding it), a spike across many accounts from one address
(spraying), and any `auth.signin.succeeded` that immediately follows a burst of
failures for the same account (a guess that landed). None of that exists.

**Asks**

- ARCHITECT: decide where alerting lives once a deployment target is chosen.
- QA-AUDITOR: until then, treat "no alerting" as a known hole rather than an
  oversight, and do not let a green test suite imply the system is watched.

---

### B-20260911-09 — `block-dangerous-git.sh` matches substrings, not push targets

- **Filed by:** Lead Orchestrator
- **Date:** 2026-09-11
- **Status:** open
- **Type:** blocker (governance correctness)

The guard blocked a legitimate push to
`agent/03-auth-rate-limit-sprint-002` because the same shell line also
contained `--base develop` for the pull-request creation that followed it. The
push target was a feature branch; nothing was going anywhere near a protected
branch.

Splitting the commands cleared it. **The guard was not bypassed and nothing was
pushed to a protected branch** — but the workaround is exactly the behaviour a
crying-wolf guard teaches, and that is the real cost.

This is the same defect class that `B-20260911-01` fixed in
`check-agent-ownership.sh`: matching a substring across a whole command line
instead of parsing the actual target. The fix is the same shape — parse the
`git push` invocation and inspect its refspec argument, rather than asking
whether the string "develop" appears anywhere nearby.

**Asks**

- PLATFORM-GUARDIAN: parse the push target properly, and add a CI case
  asserting that a feature-branch push is still allowed when the command line
  also mentions a protected branch name.

---


### B-20260911-10 — HTTP transport decisions, pre-agreed before any route ships

- **Filed by:** Lead Orchestrator, recording the deciding architect's answers
- **Date:** 2026-09-11
- **Status:** open (specification agreed, not yet implemented)
- **Type:** architecture decision — **implement exactly this when routes ship**

The owner being away, these were decided by the independent reviewer acting as
architect. Recorded here so the HTTP layer is built to an agreed spec rather
than to whatever seems reasonable on the day.

**Shape.** A framework-agnostic HTTP handler layer FIRST — request in, response
out, no framework import — which Next.js route handlers later delegate to. Same
reasoning as the session layer: the security properties stay testable without
booting a server.

**Session library.** Keep the hand-rolled session layer. Do not migrate to
Auth.js v5 now; expose the layer as an Auth.js adapter later. Rationale: the
existing code is tested and audited, and replacing working security code
carries more risk than deferring the integration.

**Rate-limit response.** Return `429` with `Retry-After` IMMEDIATELY. Drop the
server-side await, which today holds a task for up to 10 seconds and would
otherwise become a resource-exhaustion vector under a flood — see
`B-20260911-07`. The trade-off is explicit and accepted: a hostile client
ignores `Retry-After`, and the counter still advances, so repeat offenders keep
climbing the backoff curve even though they do not wait.

**Transport: COOKIE, not bearer.** Name `__session`. Attributes `HttpOnly`,
`Secure`, `SameSite=Lax`. `Max-Age` 3600. Lax rather than Strict so that inbound
links from email still work, which invoice and password-reset flows will need.

**CSRF: an explicit double-submit token on every mutating request.** The
reviewer was asked directly whether `SameSite=Lax` alone suffices for
state-changing financial operations and answered that it does not. This matters
because a successful CSRF here posts to someone's books.

**One tension to resolve at implementation time.** `Max-Age` 3600 is one hour,
but `SESSION_TTL_MS` is fourteen days. That means the cookie is dropped by the
browser long before the server session expires, which implies a refresh or
sliding-renewal mechanism that does not exist yet. Either the cookie lifetime
rises to match, or a renewal endpoint is built. Do not silently pick one.

**Resolution of that tension — 2026-09-12.** Put back to the same reviewer,
which chose sliding renewal: keep the one-hour cookie and extend the server
session on use, capped at an absolute ceiling. Implemented as two clocks rather
than one. `SESSION_IDLE_TTL_MS` (24h) is how long a session survives unused and
is what slides; `SESSION_ABSOLUTE_TTL_MS` (14d) is measured from
`sessions.created_at` and is the line renewal may not cross. The second is not
optional: without it, sliding renewal means a stolen token is valid for as long
as the thief keeps using it, and the renewal serves them exactly as well as the
real user.

The same review also replaced `__session` with `__Host-session`. The browser
refuses a `__Host-` cookie that lacks `Secure`, lacks `Path=/`, or carries a
`Domain`, which removes subdomain shadowing as an attack. The accepted cost is
that the cookie cannot span subdomains; revisit deliberately if single sign-in
across `app.` and `reports.` is ever needed.

**Status: resolved 2026-09-12** by `agent/03-http-layer-sprint-002`.
`src/server/http/` — `types.ts`, `cookies.ts`, `csrf.ts`, `handlers/auth.ts`.
206 tests pass (was 143); typecheck clean; `prisma migrate diff` reports no
drift. Two narrower follow-ups fell out of the implementation and are filed
below as `B-20260912-01` and `B-20260912-02`.

---

### B-20260912-01 — Sign-in and registration cannot be CSRF-protected by double-submit

- **Filed by:** AUTH-TENANCY
- **Date:** 2026-09-12
- **Branch:** `agent/03-http-layer-sprint-002`
- **Status:** open
- **Type:** known gap, accepted for now, not a release blocker on its own

**The gap**

`verifyCsrf` compares a non-`HttpOnly` cookie against an `x-csrf-token` header.
That works because a cross-origin page can make the browser *send* our cookies
but cannot *read* them. Sign-in and registration are the two requests where no
such cookie exists yet — the sign-in response is what issues it — so there is
nothing to submit twice. This is structural, not an omission.

**What that leaves exposed**

Login CSRF: a hostile page makes the victim's browser sign in **as the
attacker**. The victim then works in the attacker's organization, and every
invoice, journal entry and uploaded document they create is readable by
whoever owns that account. In an accounting product this is a real loss of
confidential data, not a curiosity.

**What is in place instead**

`assertSameOrigin` is applied to sign-in and registration as the primary
control rather than as the second layer it is elsewhere. It is incomplete by
design: a request with no `Origin` header passes, because browsers omit it on
some same-origin requests and non-browser callers omit it routinely, so
treating absence as hostile would break legitimate traffic. See `C22`/`C25`
in `tests/unit/http/cookies-csrf.test.ts` for what it does and does not catch.

**What would close it**

A pre-session token: the sign-in *page* issues a short-lived cookie plus a
matching hidden value, and the sign-in POST verifies the pair exactly as every
other mutation does. That requires a sign-in page, which requires the Next.js
scaffold, which is `001-1` and has not happened. Revisit when FRONTEND-UX
builds the auth shell.

**Owner:** AUTH-TENANCY, jointly with FRONTEND-UX once a page exists.

---

**RESOLVED 2026-09-12**, on `agent/10-signin-page-sprint-002`.

**How the circularity was broken.** `src/middleware.ts` commits the
`__Host-csrf` cookie one request EARLIER — on the sign-in page that carries the
form — and hands the same value to the renderer through an `x-csrf-token`
request header, which the page embeds in its HTML. `signInHandler` and
`registerHandler` now call `verifyCsrf` like every other mutation.

Middleware rather than the page itself, and not by preference: a Next 15 server
component cannot call `cookies().set()` during render — it throws — so a token
minted in the page would have no matching cookie and every submission would
403. The page refuses to render the form at all when the header is missing,
rather than rendering one that looks working and cannot work.

**Verified end to end against the running build**, not only in tests:

```text
$ curl -i http://127.0.0.1:4011/signin
set-cookie: __Host-csrf=IHw1Mt0ssR…; Path=/; Max-Age=3600; Secure; SameSite=lax
   …and the same value embedded as csrfToken":"IHw1Mt0ssR…

$ POST /api/auth/signin  (matched pair)          → 200, sets __Host-session
$ POST /api/auth/signin  (cookie, no header)     → 403 CSRF_INVALID
$ POST /api/auth/signin  (pair, wrong password)  → 401
```

**The severity recorded above was overstated, and the correction matters more
than the fix.** Pressed on its own contradictory answer, the reviewer confirmed
that `SameSite=Lax` does not send cookies on a cross-site POST at all — so a
forged sign-in from a hostile page arrives with **no** cookie and is refused on
that ground alone, and was being refused before this change. Login CSRF was
mitigated by the cookie attributes, not left open.

What the token adds is therefore defence in depth, and it is worth having for
reasons that are real but narrower than "this was exploitable": it covers
clients that do not implement `SameSite`, and it fails closed if the cookie's
attributes are ever loosened — a change to `SameSite=None` for an embedding
partner would otherwise silently reopen the hole with nothing to catch it.

**What it costs.** A non-browser client must now fetch the sign-in page for a
token before it can authenticate. That is the right trade for a browser-facing
product; a machine-to-machine path wants API keys, not this, and should be
designed as its own thing rather than by relaxing this check.

**Tests.** `H25`–`H28` (no pair is 403 with no session row; a mismatched pair
is 403; registration likewise; all three failure shapes read identically so the
body never says which half was wrong) and `A23`.

---

### B-20260912-02 — The CSRF token is not bound to the session

- **Filed by:** AUTH-TENANCY
- **Date:** 2026-09-12
- **Branch:** `agent/03-http-layer-sprint-002`
- **Status:** open
- **Type:** hardening

**What is true today**

The CSRF token is stateless: 32 random bytes, never stored, never compared
against anything except its own echo. So the check proves the caller could read
*a* cookie on our origin. It does **not** prove the token belongs to the session
being acted on. `H16` in `tests/integration/http/auth-handlers.test.ts` asserts
this honestly — one session's cookie paired with another session's token is
accepted — rather than asserting the behaviour we would prefer.

**Why it is acceptable for now**

An attacker who can set a `__Host-csrf` cookie on our origin already has a
foothold on it, and with that foothold the session cookie is reachable anyway.
The token was never the control that would have stopped them. `H16` exists so
this reasoning is visible rather than assumed.

**What would close it**

Derive the token from the session: `HMAC(server_key, session_token_hash)`,
verified rather than merely compared. It costs one hash per mutating request,
needs a key in the deployment vault, and makes the token rotate with the
session for free. Worth doing before any third party embeds our UI.

**Owner:** AUTH-TENANCY.

---

### B-20260912-03 — Email uniqueness is enforced by the service, not the database

- **Filed by:** AUTH-TENANCY
- **Date:** 2026-09-12
- **Branch:** `agent/03-http-layer-sprint-002`
- **Status:** open
- **Type:** hardening (the immediate defect is fixed; the enforcement layer is wrong)

**What happened**

Independent review found that `signIn` looked the user up by the address as
typed while `enforce` lowercased it for the rate-limit key. `registerUser`
stored it as typed. So `Admin@corp.com` and `admin@corp.com` were two separate
accounts — the `UNIQUE` constraint is on the raw string — and anyone could
register a case variant of a colleague's address. Registering as `User@x.com`
and signing in as `user@x.com` also simply failed.

**Fixed, at the wrong altitude**

`normaliseEmail` now runs inside `signIn` and `registerUser`, so every caller
gets it, not only the HTTP path. `T15`, `T16` and `T17` in
`tests/integration/auth/session.test.ts` pin the behaviour.

But this repository's own rule is that application-only validation is
insufficient for a uniqueness property (`accounting-integrity.md`, on `CHECK`
and `UNIQUE` constraints). A direct `prisma.user.create` from some future
module — an invite flow, an admin tool, a seed script — would reintroduce the
same two accounts, and nothing would stop it.

**What would close it**

Either `CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email))`, or
migrate the column to `citext`. Both are one migration. Neither was done here
because a functional index cannot be expressed in `schema.prisma`, and the CI
gate `prisma migrate diff --exit-code` would then report permanent drift — so
closing this properly means deciding how that gate treats
database objects Prisma cannot model. The same question already applies to
every trigger and `EXCLUDE` constraint in `20260911065811_init_ledger`, which
Prisma ignores rather than reports, so the answer may simply be "indexes are
the exception, document it".

**Owner:** AUTH-TENANCY, with LEDGER-CORE on the migration-drift question.

---

### B-20260912-04 — Membership changes write no audit-log row

- **Filed by:** AUTH-TENANCY
- **Date:** 2026-09-12
- **Branch:** `agent/03-org-membership-sprint-002`
- **Status:** open
- **Type:** **rule violation**, not merely a gap

**What the rules say**

`accounting-integrity.md` I9 lists "role grant" among the material actions that
must write to the immutable audit log, with actor, organization, timestamp,
action, entity and before/after. `security-tenancy.md` repeats it under security
events: "Role grant / revoke. Membership add / remove."

**What the code does**

`grantMembership`, `changeRole` and `removeMember` write nothing. A member can be
promoted to ADMIN, use that access, and be demoted again, and the only trace is
the current value of one column.

**Why it was not done in the same PR**

`audit_logs.organization_id` and `actor_id` are both `NOT NULL`, which is fine
here — both are known. The obstacle is that the existing audit helper is shaped
around ledger entities and expects an entity type and id from the journal
domain. Membership actions need either a widened entity vocabulary or their own
writer. Choosing between those is a schema decision, and bundling it into a PR
about authorization would have buried it.

**What would close it**

Decide whether `audit_logs.entity_type` gains membership values or whether
`security_events` grows structured columns and takes these. The former keeps one
trail; the latter keeps the ledger audit log purely financial. Then write the
row inside the same transaction as the membership change — an audit entry
committed separately can be missing for the one change anybody asks about.

**Owner:** AUTH-TENANCY with LEDGER-CORE, who owns the audit schema.

---

### B-20260912-05 — Ownership cannot be transferred

- **Filed by:** AUTH-TENANCY
- **Date:** 2026-09-12
- **Branch:** `agent/03-org-membership-sprint-002`
- **Status:** open
- **Type:** gap opened deliberately by the escalation rule

**The situation this creates**

`assertGrantable` refuses `OWNER` from every caller, on the grounds that
promoting a co-owner and handing over an organization are different intentions
that should not share a code path or an audit entry. That reasoning holds. The
consequence is that there is now **no route to ownership transfer at all**.

An owner who wants to step down cannot. `changeRole` refuses to touch a role at
or above the caller's own, which includes their own, and `removeMember` on the
last owner is refused by the database trigger. Both refusals are correct
individually; together they mean the founder of an organization is its owner
permanently unless a database operator intervenes.

**What would close it**

A `transferOwnership(scope, targetUserId)` action, OWNER-only, that in ONE
transaction promotes the target to OWNER and demotes the caller. The trigger is
`DEFERRABLE` precisely so this is expressible — `M23` in
`tests/integration/auth/membership.test.ts` already performs exactly that
sequence by hand and passes.

It needs a new action key (`ownership.transfer`) so it is auditable as its own
thing rather than as a role change, which was the whole argument for excluding
OWNER from `role.grant`.

**Priority:** before the membership UI ships. A screen that shows roles and
offers no way to hand over ownership will be read as a bug, and the workaround
people will ask for is to relax the escalation rule.

**Owner:** AUTH-TENANCY.

---


## Resolved

- **`B-20260912-01`** — login CSRF. Closed 2026-09-12 by a page-issued token, and
  the entry records that the original severity was overstated: `SameSite=Lax`
  was already refusing the forged request.
- **`B-20260911-10`** — HTTP transport decisions, implemented rather than merely
  recorded. Resolved 2026-09-12 on `agent/03-http-layer-sprint-002`; full entry
  retained above, including how the Max-Age tension was settled.
- **`B-20260911-05`** — the authorization gate is now structurally enforced by a
  branded scope type. Resolved 2026-09-11 via PR #10; full entry retained above.
- **`B-20260911-06`** — rate limiting on sign-in and sign-up. Resolved
  2026-09-11 via PR #9; full entry retained above.
- **`B-20260911-01`** — ownership hook now gates `Write`/`Edit` and knows the
  module paths. Resolved 2026-09-11 via PR #4; full entry retained above.
- **`B-20260911-02`** — every ledger table now has a real foreign key to
  `organizations(id)`. Resolved 2026-09-11 via PR #5; full entry retained above.
- **`B-20260527-01`** — branch protection on `main` and `develop`.
  Resolved 2026-09-11; rulesets `protect-develop` (22882053) and
  `protect-main` (22882054) verified active via the resolved-rules
  endpoint. The full entry is retained above with its history and
  resolution evidence.

---

## Rejected

*(none yet)*

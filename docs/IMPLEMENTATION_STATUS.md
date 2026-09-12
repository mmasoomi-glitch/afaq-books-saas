# docs/IMPLEMENTATION_STATUS.md

Truthful, current state of what is actually implemented, persisted,
authorized and tested in this repository. Updated by every agent at
the end of every work session.

If a module is not in this table, it does not exist. If a row is
marked `not started`, it does not exist. "Not started" is the truth;
do not soften it.

---

## State — last verified 2026-09-12 (sprint 002, the application is usable)

Re-verified against the working tree, CI and a running server. **401 tests
across 24 files pass against a real `postgres:14` container** in `ledger-ci.yml`
on every pull request; `tsc --noEmit`, `eslint` and `next build` are all clean.

`develop` @ `e4489d4`. `main` @ `3a91656` is still the empty root commit and is
still the public default branch — see `B-20260911-03`.

**What changed since the last verification is the honest headline:** the
previous version of this file said "nothing is reachable over HTTP, and no
human has ever posted a journal entry through a screen." That is no longer
true, and the paragraph has been corrected at the bottom of the table rather
than quietly deleted.

| Layer / module | State | Owner | Notes |
|----------------|-------|-------|-------|
| Repository | working | Lead | `develop` @ `5f29213`. `main` unchanged and still default — `B-20260911-03` |
| Governance docs | working | ARCHITECT | `CLAUDE.md`, 6 rule files, coordination docs, ADR-0001, `INTENTION_CONTRACT.md` v1, `CONTEXT_LEDGER.md` |
| Branch protection | working + verified | repo owner / Lead | Rulesets `protect-develop` (22882053) + `protect-main` (22882054), active, verified via the resolved-rules endpoint |
| Claude hooks | working + tested | PLATFORM-GUARDIAN | `B-20260911-01` **closed**. `check-agent-ownership.sh` now gates `Write`/`Edit`/`NotebookEdit`/`MultiEdit` as well as Bash, knows `src/modules/**`, resolves longest-prefix, matches owners by exact token. 35 local cases + 8 CI cases |
| CI | working + tested | PLATFORM-GUARDIAN | `governance-checks.yml` (5 pinned job names) + `ledger-ci.yml` (real Postgres, migration-drift check with its own shadow DB, typecheck, 206 tests, greps asserting each named DB invariant still exists in SQL, that nothing mints a `LedgerScope` outside the auth bridge, and that `src/server/http/` imports no web framework) |
| Package manager / lockfile | working | PLATFORM-GUARDIAN | pnpm 9.15.4 pinned via `packageManager`, lockfile committed |
| TypeScript config | working | PLATFORM-GUARDIAN | strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| Test framework | working + tested | PLATFORM-GUARDIAN | Vitest, `fileParallelism: false` (one shared database). Playwright still deferred with the UI |
| Application framework (Next.js) | working + tested | PLATFORM-GUARDIAN | Next 15.5, App Router, `src/app/`. `pnpm build` succeeds and is a CI gate in its own right — `tsc --noEmit` passed on imports the bundler could not resolve, so the two are not the same question. ADR-0002 |
| Lint config | working + enforced | PLATFORM-GUARDIAN | ESLint configured and a CI gate; `eslint src tests` exits 0. `next.config.ts` sets `eslint.ignoreDuringBuilds: false`, so the build enforces it too |
| Formatter (Prettier) | working + enforced | PLATFORM-GUARDIAN | `prettier --check .` is a CI gate. Config matches the pre-existing style, so adoption reformatted 66 files and changed no logic. `prisma/migrations/` is excluded because those files have run against real databases and Prisma records their checksums; `*.md` is excluded because the governance prose is hand-wrapped and reformatting would bury real edits |
| Database / Prisma | working + tested | LEDGER-CORE | 4 migrations, 16 models, `prisma migrate diff` reports no drift (verified 2026-09-12 against a throwaway shadow database) |
| Chart of accounts | working + tested | LEDGER-CORE | `createAccount`, `listAccounts`, `getAccount`, org-scoped; `getAccount` returns null for another tenant's id rather than a distinguishable error |
| Accounting periods | working + tested | LEDGER-CORE | create / close / lock / unlock, each writing a `period_locks` row and an audit row in the same transaction |
| Journals + posting | working + tested | LEDGER-CORE | `postJournalEntry` in one Serializable transaction: validates, allocates the journal number via `SELECT … FOR UPDATE`, writes draft then lines then posts by UPDATE, writes audit. Concurrency tested |
| Reversal | working + tested | LEDGER-CORE | line-by-line inverse, both link directions set, audited. The link is written with raw SQL because Prisma's `@updatedAt` would break the immutability trigger's exception |
| Period lock | working + tested | LEDGER-CORE | enforced in the database (`je_period_open`) as well as the service |
| Audit log | working + tested | LEDGER-CORE | append-only table with a trigger; written on post, reverse, lock, unlock, close, account and period creation |
| Security event log | working + tested | AUTH-TENANCY | Separate `security_events` table, append-only. Sign-in success and failure recorded. **Nothing reads it yet** — `B-20260911-08` |
| Transaction helper | working + tested | LEDGER-CORE | `withTx` at Serializable with bounded retry on SQLSTATE 40001/40P01/55P03 only; rethrows everything else and after exhausting attempts |
| Organizations / memberships | working + tested | AUTH-TENANCY | `B-20260911-02` **closed** — all 8 ledger tables now have a real FK to `organizations(id)` `ON DELETE RESTRICT` |
| Roles / permissions | working + tested | AUTH-TENANCY | per-organization roles; permissions checked by action key, hierarchy VIEWER < BOOKKEEPER < APPROVER < ACCOUNTANT < ADMIN < OWNER |
| Authorization layer | working + tested | AUTH-TENANCY | `resolveOrgScope(userId, slug)` + `assertCanDo`. Both failure modes share a message so the error cannot confirm another tenant's slug. **Enforced** via `src/modules/ledger/guarded.ts` and `src/modules/reports/guarded.ts` — but see `B-20260911-05` |
| Authentication (sessions) | working + tested | AUTH-TENANCY | Hand-rolled, framework-independent. argon2id at OWASP parameters; session tokens stored only as sha256; unknown email and wrong password are indistinguishable; membership re-resolved on every request so a revoked role takes effect immediately |
| Session lifetime | working + tested | AUTH-TENANCY | Two clocks: `SESSION_IDLE_TTL_MS` (24h) slides forward on use, `SESSION_ABSOLUTE_TTL_MS` (14d from `sessions.created_at`) is the ceiling renewal may not cross. Without the second, a stolen token kept warm would never expire |
| Rate limiting | working + tested | AUTH-TENANCY | Postgres fixed window on source address and account, progressive delay not lockout, fails **open** by design. `enforce()` reports the penalty as `Retry-After` rather than sleeping — an awaited delay was itself an exhaustion vector. Authenticated **writes** are limited too (300/min per user), enforced inside `withOrgScope` so a new endpoint cannot forget it |
| Maintenance / reaper | working + tested | PLATFORM-GUARDIAN | `POST /api/maintenance/reap` removes expired `rate_limits` rows and returns the count. Shared-secret auth, constant-time compare, **32-character floor after trimming**; unset, blank, whitespace-only and short secrets are all refused identically to a wrong one (404, never 503 — a 503 would tell an attacker whether maintenance is configured). `audit_logs` deliberately untouched — `B-20260913-02` |
| Request-id correlation | working + tested | LEDGER-CORE | Every audit row carries the request that caused it (I9). Injected by a Prisma client extension at the single point an audit row is created, carried by `AsyncLocalStorage`. An inbound `x-request-id` is **ignored** — a correlation id an attacker chooses is not evidence |
| HTTP layer | working + tested | AUTH-TENANCY | `src/server/http/`. Plain request object in, plain response object out; no framework import, enforced by CI. Security headers on every response |
| Cookies | working + tested | AUTH-TENANCY | `__Host-session` (HttpOnly) and `__Host-csrf` (deliberately not HttpOnly). The prefix makes a browser refuse a shadowing cookie from a sibling subdomain; the accepted cost is no subdomain sharing |
| CSRF | working + tested | AUTH-TENANCY | Double-submit, constant-time compare, plus an exact-match `Origin` check. **Two known gaps, both filed and tested rather than assumed away**: sign-in/registration cannot be double-submit protected (`B-20260912-01`) and the token is not session-bound (`B-20260912-02`) |
| Auth.js v5 integration | **not started** | AUTH-TENANCY | Deferred deliberately: the reviewer judged replacing working, audited security code riskier than exposing it later as an adapter. The session layer is shaped to be adopted, not rewritten |
| HTTP route handlers (Next.js) | working | PLATFORM-GUARDIAN | Four routes under `src/app/api/auth/`, each one line: `toRouteHandler(signInHandler())`. All four are `force-dynamic` and `runtime: nodejs` — a cached auth response would hand the next visitor somebody else's session |
| Web adapter | working + tested | AUTH-TENANCY | `toHttpRequest` / `toResponse` / `toRouteHandler`. Narrows the method rather than casting it; appends `Set-Cookie` rather than setting it; caps the body at 64 KiB counted over bytes received. `x-forwarded-for` is **not** believed unless `TRUST_PROXY_HEADERS=true` |
| UI / app shell | working + tested | FRONTEND-UX | Persistent nav in a layout under `/o/[orgSlug]`, so a new page cannot be added without it. Links are filtered by `can(role, action)` using the **same** action key the destination asserts. `nav.ts` holds the table so it is testable — there is no jsdom, so component-only logic is untestable in practice. 9 unit tests, including one asserting every link resolves to a `page.tsx` that exists. Hiding a link is **not** authorization and the code says so; every destination re-checks |
| Trial balance | working + tested | REPORTING-ANALYTICS | posted rows only, summed in SQL, refuses to return an unbalanced result |
| Profit and loss | working + tested | REPORTING-ANALYTICS | income credit-balance, expense debit-balance, inclusive date range, inverted range throws |
| Balance sheet | working + tested | REPORTING-ANALYTICS | cumulative to a date; income and expense roll into retained earnings; the identity assets = liabilities + equity + retained earnings is enforced at exact Decimal equality with no tolerance |
| Journal listing | working + tested | LEDGER-CORE | Keyset paging (cursor, not offset, so an entry posted mid-walk cannot push an older one past a boundary the reader has already passed) plus filtering by account and inclusive date range. Filtering by account returns each entry **in full** — a debit without its credit is half a double entry — and carries account totals summed in SQL over the whole filtered set, which a test asserts equal the trial-balance row for the same account. The cursor is fingerprinted with the filter, so changing the filter serves page one instead of a silently truncated slice. 23 tests across `journal-paging` and `journal-filter` |
| GL drilldown | not started | REPORTING-ANALYTICS | Next reporting slice, and now mostly plumbing: the filtered journal takes `account`, `from` and `to` as URL parameters and reconciles to the trial balance. What is missing is the link from a report line to it, in both directions |
| Row Level Security | **not started** | ARCHITECT | `B-20260911-04`. Tenant isolation currently rests on application-level filtering plus the `jl_org_consistency` trigger. Judged an acceptable deferral, not an acceptable permanent state |
| Customers / Invoices / Customer payments / AR aging | not started | SALES-AR | sprint 002+ |
| Suppliers / Bills / Supplier payments / AP aging | not started | PROCUREMENT-AP | sprint 002+ |
| Bank accounts / CSV import / Reconciliation | not started | BANKING-RECON | sprint 002+ |
| Document storage / AI suggestions / AI provider | not started | DOCUMENTS-AI-SAFETY | excluded from sprint 001 by clause C2 |
| UI primitives / styling | not started | FRONTEND-UX | Semantic HTML only, no styling of any kind. Empty states are truthful and written per page |
| Organization switcher | not started | FRONTEND-UX | The shell links to `/organizations`; changing organization is two clicks |
| Accessibility audit | not started | FRONTEND-UX + QA-AUDITOR | sprint 002+ |
| Cash forecasting | not started | REPORTING-ANALYTICS | post-MVP |
| Migration readiness | not started | TBD | post-MVP |
| Multi-entity expansion | not started | TBD | post-MVP |

### What "working + tested" does mean here, and what it still does not

**Corrected.** This section previously read: *"There is no user-facing
application. Every row above is a server-side module with integration tests.
Nothing is deployed, nothing is reachable over HTTP, and no human has ever
posted a journal entry through a screen."* Each of those sentences is now
false, and leaving them would have made this file the thing it exists to
prevent.

What is true today: the application runs, and the loop closes through screens —
register, sign in, create an organization, invite members, add accounts, open a
period, post a balanced entry, read it in the journal, reverse it, and see the
trial balance, profit and loss, balance sheet and audit trail move. Verified by
driving a running server, not only by the test suite.

What is still **not** true:

- **Nothing is deployed.** There is no environment, no domain, no TLS
  termination, no backups, no migration runbook. It runs on a development pod.
- **No real user has ever used it.** There is no customer data of any kind.
- **No sales, purchase, banking or document module exists** — see the rows
  above. This is a general ledger, not yet an accounting product.
- **There is no styling**, so "usable" means reachable and correct, not
  pleasant.
- **The journal has no backwards paging.** "Older entries" walks forward and
  "Most recent entries" returns to the start; there is no "previous page",
  because a cursor names where the next page begins and walking back needs the
  ordering reversed. Corrected from the previous entry here, which said the
  journal could not reach entry 101 at all — that was true when it was written
  and was fixed the same day.
- **No total count anywhere.** The journal cannot say "showing 1–100 of 347"
  without a second query that could disagree with the first under concurrent
  posting. Deferred deliberately rather than inferred.

## How to update this file

When you finish work on a module:

1. Find your row.
2. Update **State**: `not started` → `in progress` → `working +
   tested` → `production-ready` (when QA-AUDITOR confirms).
3. Update **Notes** with: the relevant migration id(s), the test
   command + count, the truthful capability boundary (e.g. "posts a
   journal with one debit and one credit per line; multi-currency
   not yet supported").

Do **not**:

- Mark a row `production-ready` to make a sprint look complete.
- Claim functionality the UI suggests but the server doesn't enforce.
- List features that are wired in nav but return 501.

If a feature is half-done, the truthful state is `in progress` with a
note describing exactly what works and what doesn't. That is more
valuable than a checkmark.

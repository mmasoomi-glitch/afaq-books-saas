# docs/coordination/SPRINT_BOARD.md

## Active sprint

**Sprint 001 — Ledger-first slice.** See
[Sprint 001](#sprint-001--ledger-first-slice-active) below.
Sprint 000 closed 2026-09-11 (`INTEGRATION_LOG.md`).

---

## Sprint 000 — Governance bootstrap (CLOSED 2026-09-11)

- **Sprint base SHA**: `3a91656329828d9bb97b567036ff9a6a1692462c`
- **Sprint base ref**: `origin/develop` (immediately after `chore: initial commit (empty repo bootstrap)`)
- **Bootstrap branch**: `chore/agent-governance-bootstrap`
- **Integration branch (planned)**: not used in sprint 000 — bootstrap PR goes directly from `chore/agent-governance-bootstrap` into `develop` because no feature branches run in parallel during this sprint.
- **Start date**: 2026-05-27
- **Target end**: when this PR merges into `develop`

## Tasks in sprint 000

| # | Owner | Task | Status | Branch | Evidence |
|---|-------|------|--------|--------|----------|
| 000-1 | Lead | Initialize repo: create `main` and `develop` from empty remote | done | `main`, `develop` | `git rev-parse origin/develop` → `3a91656...` |
| 000-2 | Lead | Inspect existing GitHub branch protection | done | n/a | `gh api .../rulesets` → `[]`; `gh api .../branches/{main,develop}/protection` → 404 (no protection set) |
| 000-3 | Lead | Create `chore/agent-governance-bootstrap` from `origin/develop` | done | `chore/agent-governance-bootstrap` | branch tracked, HEAD at sprint base SHA |
| 000-4 | Lead | Write `CLAUDE.md` | done | `chore/agent-governance-bootstrap` | file present |
| 000-5 | Lead | Write `.claude/rules/*.md` (6 files) | done | `chore/agent-governance-bootstrap` | 6 files present |
| 000-6 | Lead | Write `.claude/settings.json` + 2 hook scripts + hook README | done | `chore/agent-governance-bootstrap` | hooks parse-check OK, 7 functional tests pass for `block-dangerous-git.sh`, 4 for `check-agent-ownership.sh` |
| 000-7 | Lead | Write `docs/coordination/*` including ADR-0001 | done | `chore/agent-governance-bootstrap` | files present |
| 000-8 | Lead | Write `docs/IMPLEMENTATION_STATUS.md` | done | `chore/agent-governance-bootstrap` | file present |
| 000-9 | Lead | Write `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, `workflows/governance-checks.yml` | done | `chore/agent-governance-bootstrap` | files present |
| 000-10 | Lead | Write 12 per-agent prompt files under `docs/coordination/agent-prompts/` | done | `chore/agent-governance-bootstrap` | 12 files |
| 000-11 | Lead | Write `.gitignore` and `.gitattributes` for Next.js/TS/Prisma stack | done | `chore/agent-governance-bootstrap` | files present |
| 000-12 | Lead | Commit + push `chore/agent-governance-bootstrap` | done | `chore/agent-governance-bootstrap` | pushed; PR #1 opened and **merged** into `develop` |
| 000-13 | Lead | Prepare PR plan, present to user for approval before opening | done | n/a | PR #1 `chore(governance): agent-governance bootstrap (sprint 000)` merged; follow-up PR #2 `ci(governance): fix agent-prompt count check` merged 2026-05-28 |
| 000-14 | Lead | Configure server-side branch protection (was `B-20260527-01`) | done | n/a | rulesets `protect-develop` 22882053 + `protect-main` 22882054, `enforcement: active`, verified via `gh api .../rules/branches/{develop,main}` — full output in `INTEGRATION_LOG.md` 2026-09-11 |

> **Reporting lapse, recorded.** Rows 000-12 and 000-13 read
> `in progress` / `pending` from 2026-05-28 until 2026-09-11, while both
> PRs had in fact merged on 2026-05-28. The work was done; the board was
> not updated. Recorded here rather than silently corrected, because
> `testing-release-gates.md` makes the board the evidence trail and an
> unexplained retroactive edit would weaken it.

> When this sprint closes (merge into `develop`), the final integration
> note moves to `INTEGRATION_LOG.md`.

---

## Sprint 002 — Authentication and transport (IN PROGRESS)

- **Sprint base SHA**: `4ec44af` (`origin/develop`)
- **Start date**: 2026-09-11
- **Build/test environment**: Sophia MCP pod, PostgreSQL 14.24. The pod is a
  build environment only; commits are made and pushed from the governed local
  checkout.

| # | Owner | Task | Status | Evidence |
|---|-------|------|--------|----------|
| 002-1 | AUTH-TENANCY | Hand-rolled session layer: argon2id, sha256-stored tokens, membership re-resolved per request | done | PR #9 merged |
| 002-2 | AUTH-TENANCY | Rate limiting on sign-in and sign-up, Postgres fixed window, both dimensions | done | PR #9 merged. `B-20260911-06` closed |
| 002-3 | AUTH-TENANCY | Branded `LedgerScope` so an unauthorized caller does not compile | done | PR #10 merged. `B-20260911-05` closed |
| 002-4 | AUTH-TENANCY | Framework-agnostic HTTP layer, `__Host-` cookies, double-submit CSRF, sliding session renewal | done, reviewed | `agent/03-http-layer-sprint-002` @ `6795417`, 209 tests. `B-20260911-10` closed; `B-20260912-01`/`-02`/`-03` filed. Review found one real defect (email case), fixed in the same branch |
| 002-5 | PLATFORM-GUARDIAN | Next.js 15 scaffold; route handlers that delegate to `src/server/http/` | done, awaiting review | `agent/02b-scaffold-sprint-002`. 239 tests, `pnpm build` green, ADR-0002 records the resolution decision and its correction |
| 002-6 | ARCHITECT | Row Level Security | not started | `B-20260911-04` |
| 002-7 | AUTH-TENANCY | Web adapter: `Request`/`Response` at the edge, body cap, forwarded-header policy | done | PR #12 merged, 231 tests |
| 002-8 | AUTH-TENANCY + FRONTEND-UX | Sign-in page and a page-issued CSRF token; `B-20260912-01` closed | done, awaiting review | `agent/10-signin-page-sprint-002`, 245 tests, build green, verified against the running server |
| 002-9 | LEDGER-CORE | `request_id` on every audit row (I9), injected by a Prisma extension rather than added at eleven call sites | done | PR #40 merged, 371 tests. Found and fixed a bug I wrote: caching the *extended* client on `globalThis` silently nulls every id |
| 002-10 | AUTH-TENANCY | Rate limit authenticated writes, enforced inside `withOrgScope` so a new endpoint cannot forget it | done | PR #42 merged, 389 tests. 300/min per user, shared across organizations |
| 002-11 | PLATFORM-GUARDIAN | Maintenance reaper for expired `rate_limits` rows; shared-secret auth with a 32-char floor | done | PR #44 merged, 401 tests. PR #43 closed — see the gitleaks note below |
| 002-12 | FRONTEND-UX | App shell: persistent nav in a layout under `/o/[orgSlug]`, links filtered by the same action key the destination asserts | done | PR #45 merged, 401 tests, build green. Verified against a running server: OWNER 9 links, VIEWER 7, no audit trail or new entry |
| 002-13 | LEDGER-CORE | Keyset paging for the journal, so entry 101 is reachable | done | PR #47 merged, 411 tests. Runtime verified: 5 entries over 3 pages, no repeat or gap. Two bugs caught by the tests before merge — a `@db.Uuid` crash on a mangled cursor, and a negative page size that would have returned the OLDEST entries under a heading saying newest |
| 002-14 | LEDGER-CORE + FRONTEND-UX | Journal filtering by account and date range, with the cursor bound to the filter | done | PR #49 merged, 429 tests. **Sophia verdict: PASS.** Runtime verified: filtered account totals 600.0000 match the trial-balance row for the same account, and a cursor from one filter falls back to page one under another |
| 002-15 | AUTH-TENANCY | Database-level case-insensitive email uniqueness | done | PR #48 merged, 416 tests. Closed `B-20260912-03`, whose deferral rested on a premise that turned out to be false — see the blocker |
| 002-16 | PLATFORM-GUARDIAN | Maintenance reaper for expired `rate_limits` rows | done | PR #44 merged. PR #43 closed first: gitleaks caught a test-secret literal and the fix commit did not clear it, because the scanner reads a PR's commits rather than its tip |
| 002-17 | REPORTING-ANALYTICS | Report drill-down from any statement line to the entries behind it | done | PR #51 merged, 440 tests. **Sophia verdict: PASS.** Runtime verified via the rendered href: 700.0000 both sides. Found and fixed a pre-existing bug showing users `2024-01-31T00:00:00.000Z` as visible text on a financial statement |
| 002-18 | PLATFORM-GUARDIAN | Prettier and a formatting gate | done | PR #52 merged. **Sophia verdict: PASS**, including explicit approval of declining its own "staged files only" advice as not implementable in CI. 66 files reformatted, no logic changed. Step confirmed running in the CI log rather than inferred from a green job |

**A gap in this board, recorded rather than backfilled.** Rows 002-9 onward were
added retrospectively. The UI work that landed between 002-8 and 002-9 — the
ledger screens, the reports screens, the audit page, the `/o` namespace fix —
merged without board rows at all. The commits and PR descriptions are the
record for those; this table is not. Writing rows now from memory would look
more complete and be less true.

### 002-11 note — the gitleaks episode

PR #43 was **closed, not merged.** It committed a test secret as a high-entropy
literal and `gitleaks` failed it, correctly. Generating the value with
`randomUUID()` fixed the tip but **not the check**: gitleaks scans a PR's
commits, so the literal remained at `6b57550`.

That is the same reason a real leaked credential must be rotated rather than
deleted in a follow-up commit. Force-push being forbidden, the recovery was the
one `git-collaboration.md` prescribes — new branch from `develop`, one clean
commit, new PR (#44), old branch deleted. No real secret was exposed; the value
was a fixture that never existed outside this repository.


### 002-5 evidence

```text
$ npx tsc --noEmit
(clean)

$ npx next build
   ▲ Next.js 15.5.25
 ✓ Compiled successfully in 4.5s
   Linting and checking validity of types ...
 ✓ Generating static pages (4/4)

Route (app)                                 Size  First Load JS
┌ ○ /                                      139 B         102 kB
├ ○ /_not-found                            995 B         103 kB
├ ƒ /api/auth/register                     139 B         102 kB
├ ƒ /api/auth/session                      139 B         102 kB
├ ƒ /api/auth/signin                       139 B         102 kB
└ ƒ /api/auth/signout                      139 B         102 kB

$ npx vitest run
 Test Files  14 passed (14)
      Tests  239 passed (239)
```

All four auth routes are `ƒ` (dynamic), which is the required outcome: a
statically rendered auth response would hand the next visitor somebody else's
session. `git status` after the build is clean — Next did not rewrite
`tsconfig.json`, because ADR-0002 shaped it first.

**The build is a separate gate from the typecheck, and this branch is why.**
`tsc --noEmit` passed cleanly on imports `next build` could not resolve at all:
`moduleResolution: "bundler"` tells the TYPE CHECKER to behave as a bundler
would, and does not configure the bundler. The `.js` import suffixes — a
NodeNext requirement — had to come out, 158 of them across 35 files. ADR-0002
records that its own first version asserted otherwise without testing it.

**Known limitations.** No ESLint or Prettier yet, so `next build`'s lint step
does nothing (`ignoreDuringBuilds` is already `false`, so it starts enforcing
the moment a config lands). No UI beyond a page that states there is no UI.
`B-20260912-01` and `-02` remain open against the auth endpoints.

### 002-4 evidence

```text
$ npx tsc --noEmit
EXIT=0

$ npx vitest run
 ✓ tests/integration/ledger/invariants.test.ts (41 tests)
 ✓ tests/integration/ledger/services.test.ts (20 tests)
 ✓ tests/integration/http/auth-handlers.test.ts (24 tests)
 ✓ tests/integration/reports/statements.test.ts (15 tests)
 ✓ tests/integration/reports/trial-balance.test.ts (9 tests)
 ✓ tests/unit/http/cookies-csrf.test.ts (30 tests)
 ✓ tests/integration/auth/rate-limit.test.ts (17 tests)
 ✓ tests/integration/auth/scope.test.ts (11 tests)
 ✓ tests/integration/auth/guarded.test.ts (10 tests)
 ✓ tests/integration/auth/session.test.ts (17 tests)
 ✓ tests/integration/auth/session-renewal.test.ts (8 tests)
 ✓ tests/integration/reports/guarded-reports.test.ts (7 tests)

 Test Files  12 passed (12)
      Tests  209 passed (209)

$ npx prisma migrate diff --from-migrations prisma/migrations     --to-schema-datamodel prisma/schema.prisma --exit-code
No difference detected.
```

All 209 tests pass on `agent/03-http-layer-sprint-002` @ `6795417`.
Previous total was 143, so 66 are new: 30 covering cookie serialisation,
parsing and the CSRF comparison; 24 covering the auth handlers end to end
against a real database; 8 covering sliding renewal and the absolute ceiling;
3 covering email normalisation after review found a case-sensitivity defect;
1 added to the rate-limit suite asserting `enforce` returns promptly.

**Known limitations, stated rather than discovered later.** Nothing serves
these handlers over a socket yet — there is no Next.js scaffold, so no
endpoint is reachable by a browser. Sign-in and registration are not
double-submit protected (`B-20260912-01`) and the CSRF token is not bound to
the session (`B-20260912-02`); both are asserted as they actually behave,
including `H16`, which pins the weaker behaviour rather than the preferred one.

---

## Sprint 001 — Ledger-first slice (CLOSED 2026-09-11)

- **Sprint base SHA**: `438bb59` (`origin/develop`, after PR #1 and PR #2)
- **Start date**: 2026-09-11
- **Governing document**: [`INTENTION_CONTRACT.md`](INTENTION_CONTRACT.md) v1
- **Task tracker**: [`TODO_SPRINT_001_LEDGER.md`](TODO_SPRINT_001_LEDGER.md) — 52 items
- **Build/test environment**: Sophia MCP pod, PostgreSQL 14.24
  (`naqdengi_dev` + `naqdengi_test`). The pod is a build environment only;
  commits are made and pushed from the governed local checkout
  (contract C7.1-C7.2).

### Ordering change — owner-directed

The repository owner directed **ledger before auth-tenancy** on
2026-09-11, reversing the default order in `OWNERSHIP.md`
(platform → architect → auth-tenancy → ledger).

The owner further directed that ledger tables carry `organization_id`
as a plain `uuid NOT NULL` column with **no foreign key**, rather than
importing a stub `Organization` model.

Consequence: accounting invariant I7 is enforced at the column and
service layer only for this sprint. Tracked as `B-20260911-02`, with
the compensating database `CHECK` described in contract clause C3.3.
Named as a limitation on every ledger row in
`IMPLEMENTATION_STATUS.md`. Not to be described as complete.

### Active tasks

| # | Owner | Task | Status | Branch | Evidence |
|---|-------|------|--------|--------|----------|
| 001-0a | Lead | Full repository audit; open `INTENTION_CONTRACT.md` v1 + `TODO_SPRINT_001_LEDGER.md` | done | `chore/intention-contract-sprint-001` | both files present; audit baseline recorded in contract Part 0 |
| 001-0b | Lead | Apply + verify branch-protection rulesets; close `B-20260527-01` | done | n/a | `INTEGRATION_LOG.md` 2026-09-11 |
| 001-0c | Lead | File `B-20260911-01` (hook gaps), `-02` (ledger FK), `-03` (`main` behind `develop`) | done | `chore/intention-contract-sprint-001` | `BLOCKERS.md` |
| 001-0d | Lead | PR `chore/intention-contract-sprint-001 → develop` | todo | `chore/intention-contract-sprint-001` | — |
| 001-1b | PLATFORM-GUARDIAN | **Narrowed scaffold**: TypeScript strict, Prisma, Vitest, package scripts, `.env.example`. **No Next.js / React this sprint** (contract C2) | todo | `agent/04-ledger-core-sprint-001` | TODO phase 1 (T1.1-T1.6) |
| 001-5 | LEDGER-CORE | Ledger schema + database-level invariants | todo | `agent/04-ledger-core-sprint-001` | TODO phase 2 (T2.1-T2.11) |
| 001-5a | LEDGER-CORE | `withTx` bounded-retry helper | todo | `agent/04-ledger-core-sprint-001` | TODO phase 3 (T3.1-T3.4) |
| 001-5b | LEDGER-CORE | Ledger services: accounts, periods, post, reverse, lock | todo | `agent/04-ledger-core-sprint-001` | TODO phase 4 (T4.1-T4.7) |
| 001-5c | LEDGER-CORE | Invariant tests against real PostgreSQL | todo | `agent/04-ledger-core-sprint-001` | TODO phase 5 (T5.1-T5.11) |
| 001-6b | QA-AUDITOR | Review diff against `no-mocks-no-stubs.md`; review Sophia-authored code (contract C7.4) | todo | `agent/04-ledger-core-sprint-001` | TODO phase 6 |

### Evidence log

All three pull requests merged into `develop` on 2026-09-11 (`5f29213`).
PR #3 and #4 green on 5 required checks, PR #5 on 6.

Final CI run for PR #5, on a real `postgres:14` service container:

```text
$ pnpm prisma migrate diff --from-migrations prisma/migrations     --to-schema-datamodel prisma/schema.prisma --exit-code
No difference detected.

$ pnpm prisma migrate deploy
All migrations have been successfully applied.

$ pnpm typecheck
> tsc --noEmit
(no output, exit 0)

$ pnpm test
 PASS  tests/integration/ledger/invariants.test.ts      (41 tests)
 PASS  tests/integration/ledger/services.test.ts        (20 tests)
 PASS  tests/integration/auth/scope.test.ts             (11 tests)
 PASS  tests/integration/auth/guarded.test.ts           (10 tests)
 PASS  tests/integration/reports/trial-balance.test.ts   (9 tests)
 PASS  tests/integration/reports/statements.test.ts     (15 tests)
 PASS  tests/integration/reports/guarded-reports.test.ts (7 tests)

 Test Files  7 passed (7)
      Tests  113 passed (113)

Assert the invariants are enforced by the DATABASE, not only the schema
  OK jl_debit_credit_sign / jl_reporting_amount_consistent /
     period_no_overlap / jl_org_consistency / je_immutable / jl_immutable /
     DEFERRABLE INITIALLY DEFERRED / je_period_open / append_only /
     organization_id_fkey
```

The 41 invariant tests use a raw `pg` client rather than Prisma on purpose:
they prove the DATABASE rejects violations, not that the ORM declines to ask.

---

### Deferred within sprint 001

The tasks below were the original sprint-001 plan. They remain valid
but are **not active**, because the owner directed the ledger slice
first. They are listed unchanged so the reordering is visible rather
than rewritten away.

| # | Owner | Task |
|---|-------|------|
| 001-1 | PLATFORM-GUARDIAN | Scaffold Next.js 15 + TypeScript + Tailwind + ESLint + Prettier + Vitest + Playwright + Prisma; pin versions in `package.json`; commit lockfile; replace governance-checks CI with the real pipeline; add `pre-commit-quality-gate.sh` now that commands exist |
| 001-2 | ARCHITECT | ADR-0002 module layout; ADR-0003 transaction-helper + retry strategy; update `OWNERSHIP.md` if scaffold revealed better paths |
| 001-3 | AUTH-TENANCY | First real migration: `User`, `Organization`, `Membership`, `Role`, `Permission`, `Session`, `Account` tables; Auth.js v5 wiring; `resolveOrgScope` + `assertCanDo` helpers; tenant-isolation test harness |
| 001-4 | DOCUMENTS-AI-SAFETY | Schema for `Document`, `AISuggestion`, `AIGrounding`; storage abstraction (local-fs adapter for dev, S3-compatible adapter stub returning 503 until configured); no AI provider wired this sprint |
| 001-5 | LEDGER-CORE | Schema for `Account`, `JournalEntry`, `JournalLine`, `Period`, `PeriodLock`, `AccountingConfig` with DB-level invariants; `postJournal`, `reverseJournal`, `lockPeriod` service helpers; bounded-retry transaction helper |
| 001-6 | QA-AUDITOR | Tenant-isolation test harness, accounting-invariant test harness, no-stub scan integrated into CI |
| 001-7 | FRONTEND-UX | Auth shell (`(auth)`), org-scoped layout (`(app)/[orgSlug]`), navigation primitives, truthful empty/loading/error states; sign-in page wired to Auth.js v5 |
| 001-8 | GITKEEPER | Create `integration/sprint-001` from `origin/develop`; orchestrate the per-agent worker branches; integrate in the order defined in `OWNERSHIP.md` |

> SALES-AR, PROCUREMENT-AP, BANKING-RECON, REPORTING-ANALYTICS do
> **not** start in sprint 001 — their dependencies (ledger primitives,
> auth, orgs) must be real first. They join in sprint 002+.

---

## Reporting cadence

Every agent updates its row(s) at the end of every work session, even
mid-sprint. The "Evidence" column must contain a command + result, a
test count, a CI link, or a file path — never just "done."

GITKEEPER reviews the board at start and end of each sprint and moves
finished sprint sections into `INTEGRATION_LOG.md` once the sprint PR
merges into `develop`.

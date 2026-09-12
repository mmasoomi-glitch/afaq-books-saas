# ADR-0001: Stack — Next.js 15 (App Router) + TypeScript + Prisma + PostgreSQL + Auth.js v5

- **Status:** Accepted
- **Date:** 2026-05-27
- **Decided by:** Lead Orchestrator (user-confirmed), ARCHITECT to validate during scaffold sprint
- **Supersedes:** —

---

## Context

Naqdengi is a production-grade, multi-tenant, double-entry
accounting platform. The repository was empty at the time of this
decision, so the stack choice is being made up-front rather than
inherited from existing code. The choice locks in:

- the language and framework agents will write in,
- the ORM and migration tool that financial schemas will use,
- the authentication library and the place where authorization layers
  on top of it,
- the transaction-isolation strategy available for sensitive flows,
- the testing tools and CI shape that PLATFORM-GUARDIAN will wire up.

Wrong choices here either:

- compromise financial correctness (insufficient transaction
  guarantees, weak constraint expression at the DB level), or
- make multi-tenant authorization clumsy and easy to get wrong, or
- create constant friction for the twelve-agent workflow.

The user has explicitly approved this stack with mandatory
constraints, recorded under "Decision" below.

## Decision

The stack is:

| Layer | Choice |
|-------|--------|
| Framework | **Next.js 15** with **App Router** + React Server Components |
| Language | **TypeScript**, `"strict": true` |
| Data store | **PostgreSQL** as the authoritative persistent store |
| ORM / migrations | **Prisma** (interactive transactions, `Serializable` isolation where needed) |
| Authentication | **Auth.js v5** — the App-Router-compatible line. Not the legacy NextAuth v4 patterns. The exact published version is to be pinned by PLATFORM-GUARDIAN at scaffold time. |
| Authorization | **Custom server-side layer** — see `Server-side authorization` below |
| Tests | Vitest (unit/integration) + Playwright (e2e) — confirmed at scaffold time |
| Package manager | **pnpm** preferred — confirmed at scaffold time |

### Mandatory constraints (user-directed)

1. **App Router and strict TypeScript** throughout. No Pages Router.
2. **PostgreSQL** is the authoritative store. No in-memory or
   filesystem stand-ins outside test fixtures.
3. **Prisma migrations and Prisma transactions**, but do not rely on
   ORM convenience alone for financial correctness. Use database-level
   constraints (`CHECK`, `EXCLUSION`, `UNIQUE`, `DEFERRABLE`),
   triggers where necessary, and explicit transaction isolation.
4. For ledger posting, payment allocation, reversal, period-lock
   enforcement and other concurrency-sensitive financial actions,
   design transaction boundaries deliberately and use an appropriate
   high-isolation strategy — including `Serializable` where needed —
   with bounded retry on `40001` serialization failures.
5. **Establish accounting invariants at both service and database
   levels** wherever practical:
   - every posted journal balances (`Σ debits = Σ credits`);
   - posted financial records cannot be silently edited or deleted;
   - corrections occur through reversal or controlled adjustment;
   - organization isolation applies to every financial record;
   - reports derive from persisted ledger entries only.
6. **Auth.js v5**, current App-Router-compatible line. Do not assume
   outdated NextAuth v4 patterns (the `pages/api/auth/[...nextauth].ts`
   shape, getServerSession patterns tied to Pages Router, etc.).
   Reference the current `authjs.dev` documentation when wiring.
7. **Authentication is not authorization.** Server-side organization
   membership and role/permission enforcement run as a separate layer
   on top of the Auth.js session, on every protected action.
8. **Multi-tenant organization scope is mandatory** in schema,
   services, queries, tests and audit records.
9. **No fakes.** No fake dashboard data, no stub integrations, no
   placeholder payment success, no fabricated reconciliation, no fake
   AI output, no mock compliance claims. See
   `.claude/rules/no-mocks-no-stubs.md`.
10. **Do not begin broad feature coding until:**
    - governance bootstrap is committed on its own feature branch;
    - ownership map exists;
    - Git/worktree rules exist;
    - branch protections are verified or clearly documented as
      requiring human configuration;
    - this ADR-0001 is written (this file).

### Transaction-integrity requirements

- Use `prisma.$transaction(async (tx) => {...}, { isolationLevel:
  'Serializable' })` for any flow that posts to the ledger, allocates
  a payment, reverses an entry, or enforces a period lock.
- Implement a single shared helper that wraps `$transaction` with
  bounded retry (e.g. up to 3 retries, exponential backoff with
  jitter) on serialization failures (`40001`) and lock-not-available
  errors. Use that helper everywhere — do not retry inline at call
  sites.
- For high-contention monotonic counters (invoice number per
  organization, journal number per period, etc.), use a dedicated
  sequence table with `SELECT … FOR UPDATE`, **not** application-side
  `MAX()+1`. Document this pattern in a follow-up ADR when the first
  counter is introduced.
- Use Prisma's raw query escape hatch (`$queryRaw` / `$executeRaw`)
  for `SELECT … FOR UPDATE`, `INSERT … ON CONFLICT`, and any pattern
  Prisma's high-level API cannot express precisely.
- Use database-enforced constraints as the primary defense against
  invariant violation:
  - `CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))`
    on journal lines;
  - a `BEFORE INSERT` trigger or `DEFERRABLE INITIALLY DEFERRED`
    constraint that asserts `SUM(debit) = SUM(credit)` per
    journal-entry id;
  - an `UPDATE`/`DELETE` trigger or revoked grant that prevents
    mutation of rows where `posted_at IS NOT NULL`;
  - `UNIQUE (organization_id, period_id, journal_number)` for
    counter uniqueness;
  - `EXCLUDE` constraints where appropriate for date-range overlaps
    (e.g. period definitions).

### Authentication / authorization boundary

- **Authentication** (who is this user) is solved by Auth.js v5. We
  use the framework's session helpers in Server Components and Route
  Handlers; we never reach into the cookie ourselves.
- **Authorization** is a separate module under (path TBD by
  ARCHITECT) `src/server/auth/` or similar. It exposes:
  - `resolveOrgScope(req)` — given an authenticated request and the
    requested org slug from the URL, returns `{ userId,
    organizationId, role }` if the user is a member, otherwise
    throws.
  - `assertCanDo(scope, action, resource?)` — given a resolved scope
    and an action key (e.g. `'ledger.post'`, `'invoice.allocate'`),
    throws if the role lacks permission.
- Every server action / route handler that touches business data
  calls both, in that order, before any Prisma write.
- The client-side UI may disable a button based on a permission set
  returned with the session, but that is a UX hint only — the
  server-side check is the gate.
- Auth providers: start with credentials (email + password, with
  argon2id hashing) and one OAuth provider (TBD); both routed through
  Auth.js v5's standard handlers.
- Session storage: database adapter (Prisma adapter), not JWT-only.
  This lets us revoke sessions when a membership is removed.

### Multi-tenant organization scope

- Every business-data table has an `organization_id` column with a
  non-null foreign key.
- Row-level security: Postgres `ROW LEVEL SECURITY` policies are
  **strongly preferred** as a second line of defense. The application
  sets a session variable (`SET LOCAL app.current_organization`) at
  the start of every transaction; RLS policies use it to filter rows.
  Application-level filtering remains, so we get defense in depth.
  (Decision on whether to enable RLS in sprint 001 vs deferred is for
  ARCHITECT in ADR-0003 or similar.)
- Cross-tenant access tests are required for every module touching
  org-scoped data. See `.claude/rules/security-tenancy.md`.

## Consequences

### Positive

- Mainstream TypeScript SaaS stack — broad documentation, active
  ecosystem, predictable hiring pool.
- App Router + RSC reduces hand-rolled API surface; many reads can
  be Server Components calling Prisma directly within an authorized
  scope, lowering the attack surface.
- Prisma's schema language + migrations is well-suited to a long-
  lived, audited financial schema; migration history is reviewable.
- PostgreSQL gives us the constraint and isolation primitives we need
  for financial correctness (`Serializable`, `FOR UPDATE`,
  `DEFERRABLE`, `RLS`, `CHECK`, `EXCLUDE`).
- Auth.js v5 is the App-Router-native authentication path; staying
  current avoids the trap of writing v4-flavored code that would
  silently misuse new session semantics.
- TypeScript strict mode catches a category of financial-data shape
  errors (currency vs amount, integer minor units vs decimal) before
  they reach the runtime.

### Negative

- Next.js App Router is still evolving; some patterns (caching,
  revalidation tags, edge vs node runtime) have moved between minor
  versions. We mitigate by pinning a known-good version and tracking
  release notes when we bump.
- Prisma's high-level API does not cover every PostgreSQL feature we
  will need (e.g. fine-grained RLS, some constraint types). We will
  use `$queryRaw` and migration files for those. This is fine, but
  it means migration review by the schema owner is non-optional.
- Auth.js v5's docs and community examples are uneven — some still
  show v4 patterns. Agents must read `authjs.dev` for the current
  guidance, not Stack Overflow snapshots.
- Serverless deploy of Next.js can complicate long-running transaction
  patterns (cold starts, connection limits). PLATFORM-GUARDIAN will
  address this in the scaffold sprint (Prisma connection pooling, e.g.
  via `prisma-accelerate` or PgBouncer in transaction-pooling mode,
  with awareness of which Prisma features are compatible).
- A custom authorization layer means we own its correctness. We
  mitigate with the test surfaces required in
  `.claude/rules/security-tenancy.md`.

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Prisma serialization-failure storms under contention | Bounded retry helper with backoff; load tests on posting flow before launch |
| Auth.js v5 minor-version breakage | Pin exact version; subscribe to release notes; integration tests over sign-in / authorization gate |
| Connection-pool exhaustion in serverless | Use PgBouncer transaction-pooling or Prisma's accelerate, with awareness that some Prisma features (e.g. interactive transactions) require session-pooling — document the policy in an ADR before deploy |
| Migrations that quietly relax invariants | Mandatory review by LEDGER-CORE for any migration touching ledger tables, regardless of authoring agent |
| RLS bypass via misconfigured Prisma client | Single shared Prisma client factory; raise an error if `SET LOCAL app.current_organization` was not called before a query in an authorized scope |

### Deployment and testing assumptions

- **Runtime**: Node.js (not Edge), so we get full Prisma support and
  predictable transaction semantics. Edge is allowed for purely-read,
  cache-friendly endpoints (e.g. marketing pages), with an explicit
  ADR before any business data is read from Edge.
- **Hosting**: TBD — Vercel, Fly, Railway, self-hosted Postgres are
  all on the table. The decision must come before the first deploy
  ADR. Until then, the development target is local Postgres in Docker
  Compose (PLATFORM-GUARDIAN sprint 001).
- **Testing**:
  - Unit/integration via Vitest, run on every PR.
  - End-to-end via Playwright, run on every PR and on the integration
    branch.
  - Accounting-invariant tests via Vitest with a real Postgres test
    database (no in-memory SQLite — its constraint and isolation
    semantics differ from Postgres).
  - Tenant-isolation tests via Vitest + real Postgres.
- **CI**: GitHub Actions, with `governance-checks.yml` running in
  bootstrap sprint 000 and the full pipeline added in sprint 001.

## Alternatives considered

- **Django + Postgres + django-allauth + DRF.** Mature, transactional,
  ORM well-suited to finance. Loses TypeScript end-to-end (front +
  back), loses RSC, requires a separate SPA — adds an integration
  surface and a second auth perimeter. Rejected.
- **Rails 8 + Postgres + Devise.** Similarly mature, very productive,
  but again loses end-to-end TypeScript and adds the SPA-or-Turbo
  decision burden. Rejected.
- **Defer the decision to ARCHITECT.** Would let governance docs land
  first with stack TBD. User explicitly chose to lock the stack now
  to unblock the rest of the bootstrap.

## References

- Next.js App Router docs: https://nextjs.org/docs/app
- Prisma transactions & isolation:
  https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Auth.js v5 getting started: https://authjs.dev/getting-started
- PostgreSQL transaction isolation:
  https://www.postgresql.org/docs/current/transaction-iso.html
- This repo's `.claude/rules/accounting-integrity.md` (database-level
  invariants), `.claude/rules/security-tenancy.md` (authorization
  boundary), `.claude/rules/no-mocks-no-stubs.md` (truthful states).

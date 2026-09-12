# Agent 03 — AUTH-TENANCY

You are AUTH-TENANCY on Nagdengi. Slug: `auth-tenancy`.

## Read first (mandatory)

1. `CLAUDE.md`
2. `.claude/rules/git-collaboration.md`
3. `.claude/rules/security-tenancy.md`  ← especially this
4. `.claude/rules/accounting-integrity.md`
5. `.claude/rules/no-mocks-no-stubs.md`
6. `.claude/rules/testing-release-gates.md`
7. `docs/coordination/PROJECT_BRIEF.md`
8. `docs/coordination/OWNERSHIP.md`
9. `docs/coordination/SPRINT_BOARD.md`
10. `docs/coordination/adr/0001-stack-nextjs15-prisma-postgres-authjs.md`
11. `docs/IMPLEMENTATION_STATUS.md`

## Your responsibility

Authentication (Auth.js v5) and **separate** server-side
authorization with per-organization roles. Organizations,
memberships, role and permission models. Tenant isolation enforced
at schema + service + test levels.

## Your owned write-paths

- `src/server/auth/**`
- `src/app/(auth)/**`
- `src/modules/*/auth/**` (cross-module auth glue)
- Schema sections for `User`, `Organization`, `Membership`, `Role`,
  `Permission`, `Session`, `Account` in `prisma/schema.prisma`
- The migrations introducing those models
- `tests/integration/auth/**`, `tests/integration/tenancy/**`

You share `prisma/schema.prisma` with LEDGER-CORE. Coordinate
sections; don't edit ledger tables. GITKEEPER sequences merges.

## Your branch (sprint 001)

```
agent/03-auth-tenancy-sprint-001  # branched from origin/develop
```

## Your sprint 001 tasks

1. **Define and migrate the identity / org schema:**
   - `User` (id, email unique, hashed_password optional for OAuth,
     created_at, updated_at, …)
   - `Account` (Auth.js adapter — OAuth account links)
   - `Session` (Auth.js adapter — DB-backed sessions, *not* JWT)
   - `Organization` (id, slug unique, name, created_at, …)
   - `Membership` (user_id, organization_id, role, joined_at — unique
     on (user_id, organization_id))
   - `Role` (id, key unique e.g. `viewer`, `bookkeeper`, …)
   - `Permission` (id, key unique e.g. `ledger.post`, `invoice.allocate`)
   - `RolePermission` (role_id, permission_id — join)
   - Seed the role rows + their permission rows in
     `prisma/seed/auth.ts` (labelled, not loaded in prod).
   - Database constraints: FKs, `UNIQUE`, `CHECK` where applicable.
2. **Wire Auth.js v5** for the App Router. Use the Prisma adapter
   (`@auth/prisma-adapter`). Configure DB-backed sessions. Provider:
   credentials (email + argon2id-hashed password) for v1; add one
   OAuth provider stub (do not enable without secrets).
3. **Build the authorization layer** under `src/server/auth/`:
   - `auth()` — re-export of the framework helper.
   - `resolveOrgScope(req | { headers, params }): Promise<OrgScope>` —
     given the authenticated session and the requested `[orgSlug]`,
     returns `{ userId, organizationId, role }` if the user is a
     member; throws a typed `NotAMemberError` otherwise.
   - `assertCanDo(scope, actionKey: string, resource?: { id: string }): Promise<void>` —
     throws a typed `ForbiddenError` if the role lacks the permission.
   - Action-key catalog in `src/server/auth/permissions.ts`. Keep
     keys stable; this is the API other modules will reference.
4. **Wire RLS as defense-in-depth** (recommended if achievable in
   sprint 001; otherwise file a deferral):
   - On every authorized DB call, set `SET LOCAL
     app.current_organization = '<org-uuid>'` at the start of the
     transaction.
   - Create `ROW LEVEL SECURITY` policies on org-scoped tables that
     filter by that variable.
   - Add a unit test that bypassing `SET LOCAL` returns zero rows.
5. **Tenant-isolation tests** (mandatory):
   - User in org A reading org A's data works.
   - User in org A guessing org B's ids returns 404.
   - User removed from org A mid-session is blocked on next request.
   - List endpoints never leak across orgs under any filter.
   - Privilege-escalation tests for every role.
6. **Sign-in / sign-out pages** under `src/app/(auth)/`. Truthful
   empty/error states. No fake "magic link sent" without an actual
   email send (or a clearly-labelled dev mode that logs the link to
   the server console — never to the browser).

## What you do NOT do

- Edit ledger schema or any feature-module domain code.
- Implement billing or subscription logic (that's a future module).
- Add OAuth provider secrets to the repo (PLATFORM-GUARDIAN owns
  `.env.example` placeholders).

## Critical correctness notes

- **Authentication ≠ authorization.** Every server action or route
  handler that touches business data calls both
  `resolveOrgScope(req)` and `assertCanDo(scope, key)` *before* any
  Prisma write. A successful Auth.js session is necessary but not
  sufficient.
- **Sessions are database-backed.** When a membership is revoked,
  the next request on an existing session must fail authorization.
  JWT-only sessions can't enforce this without a revocation cache;
  DB sessions can.
- **Cookies and headers.** `HttpOnly`, `Secure`, `SameSite=Lax` at
  minimum. Add CSP and security headers via middleware.
- **Rate limit** sign-in, sign-up, password-reset routes.
- **Password storage** — argon2id (memory-hard) with appropriate
  parameters. Never bcrypt-with-low-cost or unsalted SHA.
- **Auth.js v5 differences from v4.** Use the current published
  patterns (App-Router-native, `auth()` from your own
  `src/server/auth/index.ts` re-export, route handler at
  `src/app/api/auth/[...nextauth]/route.ts`, RSC-friendly session
  reads). Do not paste from v4 Stack Overflow snippets.

## Workflow

1. Confirm branch and SHA.
2. File a schema proposal under `docs/coordination/schema-proposals/`
   only if you need columns on LEDGER-CORE's tables; otherwise your
   tables are your own.
3. Small commits per concern: `feat(auth): User + Session schema`,
   `feat(auth): wire Auth.js v5 credentials provider`,
   `feat(auth): resolveOrgScope + assertCanDo`,
   `test(auth): tenant isolation harness`.
4. Run tests. Paste output into `SPRINT_BOARD.md` evidence.
5. Push branch.
6. Tag QA-AUDITOR + GITKEEPER.

## Reporting

`IMPLEMENTATION_STATUS.md` rows: Authentication, Authorization layer,
Organizations / memberships, Roles / permissions. Move from `not
started` to `working + tested` with notes (e.g. "DB-backed sessions;
RLS enabled; 14 tenant-isolation tests pass").

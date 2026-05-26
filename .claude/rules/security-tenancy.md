# .claude/rules/security-tenancy.md

Multi-tenant security rules for Afaq Books SaaS. Applies to AUTH-TENANCY
(owner) and to every other agent (consumer).

---

## Authentication vs authorization

- **Authentication** answers "who is this user." We use Auth.js v5 on
  Next.js 15 App Router. A valid session means we know the user, period.
- **Authorization** answers "is this user allowed to do this action on
  this organization's data." A valid session does **not** answer that.
  Authorization checks are separate, server-side, and per-request.

A server-side `auth()` call returning a user is necessary but never
sufficient. Every authorized action also runs an `assertCanDo(user,
action, organizationId, resource)` check.

---

## Organization tenancy

- Every business entity row carries `organization_id`.
- Membership is a join: `(user_id, organization_id, role)` with
  per-organization roles, not global roles.
- A user may belong to multiple organizations; the active organization
  is selected per request (URL segment `/(app)/[orgSlug]/...` or
  explicit session-bound active-org id — ARCHITECT decides; ADR
  records).
- Server-side, every query filters by the resolved `organization_id`
  derived from authenticated session + URL, not from a client-supplied
  field.

Forbidden:

```ts
// BAD — trusts the client's organizationId
await prisma.invoice.findMany({ where: { organizationId: input.orgId } });
```

```ts
// GOOD — derives organizationId from the authenticated, authorized scope
const scope = await resolveOrgScope(req); // throws on missing membership
await prisma.invoice.findMany({ where: { organizationId: scope.organizationId } });
```

The accepted-input field for orgId is the URL `[orgSlug]` (or equivalent),
mapped server-side to an id via a membership-verified lookup.

---

## Roles and permissions

Roles are per-organization. At minimum:

| Role          | Reads                        | Writes                          |
|---------------|------------------------------|---------------------------------|
| `viewer`      | reports, ledger              | none                            |
| `bookkeeper`  | + drafts, bills, invoices    | draft create/edit, post, allocate |
| `approver`    | as bookkeeper                | + approve bills/payments        |
| `accountant`  | as approver                  | + period close, adjusting entries |
| `admin`       | everything                   | + role grants, period **lock** |
| `owner`       | everything                   | + member removal, billing       |

Permissions are checked by **action**, not by role name, so the table
above is a default mapping. Action keys live in
`src/server/auth/permissions.ts` (path TBD by ARCHITECT) and are
referenced from feature modules.

Permission checks happen:

- In server actions / route handlers — never only on the client.
- Before the DB write — never as a UI-disabled-button "check."
- With the org scope already resolved — never on raw user input.

---

## Required test surfaces

For every module that touches organization-scoped data, QA-AUDITOR
requires:

1. **Membership negative test** — user with no membership in org A
   cannot read/write org A's data, even by guessing IDs.
2. **Cross-tenant ID confusion test** — passing org B's invoice id to a
   route scoped under org A returns 404 (not 200, not 403 with the body
   leaking the existence).
3. **Privilege escalation test** — a `viewer` cannot post, allocate,
   approve, lock periods or change roles, even by direct API call.
4. **Active session, removed membership** — a user whose membership in
   org A was revoked mid-session cannot continue acting on org A's data
   on the next request.
5. **API enumeration test** — list endpoints never return data from
   another org under any filter shape.

---

## Secrets and configuration

- `.env*` is gitignored except `*.example` files.
- `.env.example` shows variable names and harmless placeholder values
  (e.g. `DATABASE_URL=postgresql://user:pass@localhost:5432/afaq_dev`).
- Real secrets live in the operator's deployment vault. Documenting
  them in commits, prompts, logs or memory is forbidden.
- `AUTH_SECRET` must be sufficient entropy (≥32 random bytes,
  base64-encoded).
- Never commit credentials for third-party providers (Stripe, banking
  aggregators, e-invoicing portals, document storage). Use server-only
  environment variables and route them through a single config module.

---

## Audit logging — security events

In addition to the financial audit log (`accounting-integrity.md` I9),
log:

- Sign-in success/failure (with rate-limit context).
- Role grant / revoke.
- Membership add / remove.
- Period lock / unlock.
- Admin-only configuration changes.
- AI-suggestion accept / reject (because they touch financial state).

Logs are append-only, organization-scoped where applicable, and
queryable by an authorized accountant for the trailing audit window.

---

## Headers, CSRF, sessions

- Auth.js v5 in App Router uses double-submit / encrypted cookie patterns
  by default. Do not disable them.
- Cookies are `HttpOnly`, `Secure`, `SameSite=Lax` at minimum;
  `SameSite=Strict` if the UX allows.
- CSP, `Strict-Transport-Security`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-
  when-cross-origin` are set in `next.config.ts` headers / middleware.
- Rate limit sign-in attempts, sign-up, password-reset and AI endpoints.

# .claude/rules/no-mocks-no-stubs.md

This is a real accounting platform. Visible-but-fake functionality is
the primary failure mode we are preventing.

---

## What is forbidden in production code paths

- In-memory arrays as the data store for any feature visible to a user.
- Browser `localStorage` / `sessionStorage` as the source of truth for
  any business data.
- Components that call a fake "service" returning hardcoded data.
- Routes returning `{ success: true }` without a corresponding DB write
  and authorization check.
- Forms that POST and toast "Saved" without persisting through a real
  server action + Prisma transaction.
- AI features that return canned suggestions independent of real data.
- Reconciliation UIs that animate a "matched" state without writing a
  match row.
- Tax / e-invoicing / payment-provider widgets that pretend to have
  contacted an upstream system.
- Dashboard cards displaying made-up numbers ("$12,438 owed" with no
  query backing them).
- "Coming soon" pages that are wired into navigation as if functional.

---

## What is allowed and how to label it

- **Fixtures and seed data** for development and tests, under explicit
  directories: `prisma/seed/`, `src/**/__fixtures__/`, `tests/fixtures/`.
  Seed data must be obviously synthetic ("Acme Corp", "Demo User",
  recognizable amounts) and must never be loaded by the production
  startup path.
- **Truthful empty states**. A new organization with no invoices shows
  "No invoices yet" — not three fake invoices for visual padding.
- **Truthful loading states**. While data is fetching, show a skeleton
  or spinner — never a "preview" of what will be there.
- **Truthful not-configured states**. If the bank integration provider
  is not configured, the UI says "Bank import not configured" with a
  link to setup, and the import endpoint returns `503` with a clear
  reason. It does not show a green check.
- **Truthful failed states**. If the AI service is unreachable, the UI
  says so. It does not fall back to a hardcoded suggestion presented
  as the AI's output.

---

## Provider abstractions

When integrating an external provider (payments, banking aggregator,
e-invoicing, document storage, AI):

1. Define an interface in the server layer with the operations the
   product needs.
2. Implement one **real** adapter against the provider's API.
3. For local development, you may also have a `LocalProviderAdapter`
   that uses a real local resource (e.g. local Postgres for document
   storage, local file system, a self-hosted Ollama for AI). It is
   **not** a "fake" — it really stores data — it is just the local
   variant.
4. Selection is by environment variable (`STORAGE_PROVIDER=s3` vs
   `STORAGE_PROVIDER=local`).
5. The UI shows the active provider in a debug/admin page so operators
   know what is actually running.

A `MemoryAdapter` or `FakeAdapter` is allowed **only** under test
directories and may not be reachable from any production route.

---

## TODO discipline

`TODO`, `FIXME`, `XXX`, `HACK` markers are tracked, not banned:

- Each marker must link to an issue or to a section in `BLOCKERS.md`.
- A `TODO` in a happy-path may not silently no-op a financial action.
  If the financial action is not implemented, the endpoint returns an
  explicit `501 Not Implemented` (or feature-disabled response) and
  the UI does not offer the action.

Example, forbidden:

```ts
// TODO: post to ledger
await prisma.invoice.update({ data: { status: 'paid' } }); // <-- silent
```

Example, acceptable:

```ts
// payment allocation not implemented — see BLOCKERS.md#sales-ar-payments
throw new NotImplementedError('payment allocation');
```

---

## How QA-AUDITOR catches violations

QA-AUDITOR runs scans on the integration branch:

- `rg -n "TODO|FIXME|XXX|HACK"` cross-referenced with the issue tracker.
- AST-aware search for endpoints returning `{ success: true }` without
  a Prisma write in the same function scope.
- Detection of `useState` initialized with the data shape of a primary
  business entity (invoice, ledger entry, payment) — that pattern often
  signals fake-data prototypes.
- Detection of `process.env.NODE_ENV === 'production'` guards used to
  hide fake behavior; that is the wrong sign-off mechanism.

A violation is a release-blocking finding.

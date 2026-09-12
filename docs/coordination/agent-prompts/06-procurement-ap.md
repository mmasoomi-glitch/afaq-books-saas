# Agent 06 — PROCUREMENT-AP

You are PROCUREMENT-AP on Nagdengi. Slug: `procurement-ap`.

## Read first (mandatory)

1. `CLAUDE.md`
2. `.claude/rules/git-collaboration.md`
3. `.claude/rules/accounting-integrity.md`
4. `.claude/rules/security-tenancy.md`
5. `.claude/rules/no-mocks-no-stubs.md`
6. `.claude/rules/testing-release-gates.md`
7. `docs/coordination/PROJECT_BRIEF.md`
8. `docs/coordination/OWNERSHIP.md`
9. `docs/coordination/SPRINT_BOARD.md`
10. `docs/coordination/adr/0001-stack-nextjs15-prisma-postgres-authjs.md`
11. `docs/IMPLEMENTATION_STATUS.md`

## Sprint 001 status

You do **not** start until LEDGER-CORE has merged. Likely **sprint
002 or later.**

## Your responsibility

Suppliers, bills (received from vendors), bill approval workflow,
supplier payments, payment allocation, AP aging, and supplier
bank-detail-change controls. All postings flow through LEDGER-CORE.

## Your owned write-paths

- `src/modules/procurement/**`
- Schema sections for `Supplier`, `Bill`, `BillLine`,
  `SupplierPayment`, `BillApproval` in `prisma/schema.prisma`
- Migrations for those models
- `tests/integration/procurement/**`, `tests/unit/procurement/**`

## Your sprint NN tasks

1. **Schema:**
   - `Supplier` (id, organization_id, name, contact info, tax_id,
     currency, payment_terms_days, bank_account_iban /
     bank_account_number, is_active)
   - `Bill` (id, organization_id, supplier_id, bill_number,
     received_date, due_date, status: draft/approved/posted/paid,
     currency, subtotal, tax_total, total, balance_due,
     source_journal_id, voided_at, voided_by)
   - `BillLine` (id, bill_id, description, quantity, unit_price,
     line_total, tax_rate, account_id — expense account from CoA)
   - `BillApproval` (id, bill_id, approver_user_id, approved_at,
     comment) — append-only history
   - `SupplierPayment` (id, organization_id, supplier_id, paid_date,
     method, currency, amount, reference, source_journal_id)
   - `BillPaymentAllocation` (id, payment_id, bill_id, amount)
2. **Bill posting** (`postBill(scope, billId)`):
   - Requires approval if AccountingConfig.require_bill_approval =
     true. Validate approval rows exist before posting.
   - Build journal: debit Expense per line, debit Tax Recoverable
     for tax, credit Accounts Payable.
   - Call `ledger.postJournalEntry`. Set `bill.source_journal_id`.
3. **Supplier payment + allocation** — mirror of SALES-AR's flow:
   - Journal: debit Accounts Payable, credit Cash/Bank.
   - Allocation rows link payment to one or many bills.
   - Status derived from allocations.
4. **Supplier bank-detail change control** — see "Critical
   correctness notes" below. Any change to `Supplier.bank_account_*`
   writes an audit-log row with old/new values, and (if config
   requires it) needs a second-approver before becoming effective.
5. **AP aging** — same shape as AR aging but inverted.
6. **Tests:**
   - Bills cannot be posted without required approvals.
   - Posting a bill creates a balanced journal.
   - Payment allocation across multiple bills sums correctly.
   - Bank-detail change is audited and (when required) gated.
   - Tenant isolation tests.

## What you do NOT do

- Write to ledger tables.
- Build email/notification sending (later module).
- Auto-pay (later module — and gated behind explicit human action).

## Critical correctness notes

- **Supplier bank fraud** is one of the most common attack vectors
  in real accounting systems. An attacker who can change a
  supplier's bank details silently can divert payments. Treat
  `Supplier.bank_account_*` mutations as high-risk: audit
  always; second-approver when org config requires it.
- **Approval is evidence.** A `Bill` with `status = approved`
  requires at least one `BillApproval` row by a user with the
  `bill.approve` permission (per org config: maybe two).
- **No "fake approved" buttons.** Approval is a server-side write
  with audit. UI cannot synthesize it.

## Reporting

`IMPLEMENTATION_STATUS.md` rows: Suppliers, Bills, Supplier
payments, AP aging.

import type { OrgScope } from "../../server/auth/scope";
import { assertCanDo, toLedgerScope } from "../../server/auth/scope";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  CustomerFilters,
  CustomerSummary,
} from "./customers";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deactivateCustomer,
} from "./customers";

import type {
  CreateInvoiceInput,
  InvoiceSummary,
  InvoiceFilters,
} from "./invoices";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  postInvoice,
  cancelInvoice,
  voidInvoice,
} from "./invoices";

import type {
  CreatePaymentInput,
  PaymentAllocationInput,
  PaymentSummary,
} from "./customer-payments";
import {
  createCustomerPayment,
  applyPayment,
  unapplyPayment,
  recordUnappliedPayment,
} from "./customer-payments";

import type {
  CreateCreditNoteInput,
  CreditNoteSummary,
} from "./credit-notes";
import {
  createCreditNote,
  issueCreditNote,
  applyCreditNote,
  expireCreditNote,
} from "./credit-notes";

import type { ArAgingResult } from "./ar-aging";
import { arAging } from "./ar-aging";

// ── Customers ──────────────────────────────────────────────────────────

export async function guardedCreateCustomer(
  scope: OrgScope,
  input: CreateCustomerInput,
): Promise<CustomerSummary> {
  assertCanDo(scope, "sales.customer.create");
  return createCustomer(toLedgerScope(scope), input);
}

export async function guardedGetCustomer(
  scope: OrgScope,
  customerId: string,
): Promise<CustomerSummary | null> {
  assertCanDo(scope, "sales.customer.read");
  return getCustomer(toLedgerScope(scope), customerId);
}

export async function guardedListCustomers(
  scope: OrgScope,
  filters?: CustomerFilters,
): Promise<CustomerSummary[]> {
  assertCanDo(scope, "sales.customer.read");
  return listCustomers(toLedgerScope(scope), filters);
}

export async function guardedUpdateCustomer(
  scope: OrgScope,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerSummary> {
  assertCanDo(scope, "sales.customer.create");
  return updateCustomer(toLedgerScope(scope), customerId, input);
}

export async function guardedDeactivateCustomer(
  scope: OrgScope,
  customerId: string,
): Promise<CustomerSummary> {
  assertCanDo(scope, "sales.customer.create");
  return deactivateCustomer(toLedgerScope(scope), customerId);
}

// ── Invoices ───────────────────────────────────────────────────────────

export async function guardedCreateInvoice(
  scope: OrgScope,
  input: CreateInvoiceInput,
): Promise<InvoiceSummary> {
  assertCanDo(scope, "sales.invoice.create");
  return createInvoice(toLedgerScope(scope), input);
}

export async function guardedGetInvoice(
  scope: OrgScope,
  invoiceId: string,
): Promise<InvoiceSummary | null> {
  assertCanDo(scope, "sales.customer.read");
  return getInvoice(toLedgerScope(scope), invoiceId);
}

export async function guardedListInvoices(
  scope: OrgScope,
  filters?: InvoiceFilters,
): Promise<InvoiceSummary[]> {
  assertCanDo(scope, "sales.customer.read");
  return listInvoices(toLedgerScope(scope), filters);
}

export async function guardedPostInvoice(
  scope: OrgScope,
  invoiceId: string,
): Promise<void> {
  assertCanDo(scope, "sales.invoice.post");
  return postInvoice(toLedgerScope(scope), invoiceId);
}

export async function guardedCancelInvoice(
  scope: OrgScope,
  invoiceId: string,
  reason: string,
): Promise<void> {
  assertCanDo(scope, "sales.invoice.cancel");
  return cancelInvoice(toLedgerScope(scope), invoiceId, reason);
}

export async function guardedVoidInvoice(
  scope: OrgScope,
  invoiceId: string,
): Promise<void> {
  assertCanDo(scope, "sales.invoice.cancel");
  return voidInvoice(toLedgerScope(scope), invoiceId);
}

// ── Payments ───────────────────────────────────────────────────────────

export async function guardedCreatePayment(
  scope: OrgScope,
  input: CreatePaymentInput,
): Promise<PaymentSummary> {
  assertCanDo(scope, "sales.payment.create");
  return createCustomerPayment(toLedgerScope(scope), input);
}

export async function guardedApplyPayment(
  scope: OrgScope,
  paymentId: string,
  allocations: PaymentAllocationInput[],
): Promise<void> {
  assertCanDo(scope, "sales.payment.apply");
  return applyPayment(toLedgerScope(scope), paymentId, allocations);
}

export async function guardedUnapplyPayment(
  scope: OrgScope,
  allocationId: string,
): Promise<void> {
  assertCanDo(scope, "sales.payment.apply");
  return unapplyPayment(toLedgerScope(scope), allocationId);
}

export async function guardedRecordUnappliedPayment(
  scope: OrgScope,
  customerId: string,
  amount: number | string,
  method: string,
  currency: string,
): Promise<PaymentSummary> {
  assertCanDo(scope, "sales.payment.create");
  return recordUnappliedPayment(toLedgerScope(scope), customerId, amount, method as Prisma.EnumPaymentMethod, currency);
}

// ── Credit Notes ──────────────────────────────────────────────────────

export async function guardedCreateCreditNote(
  scope: OrgScope,
  input: CreateCreditNoteInput,
): Promise<CreditNoteSummary> {
  assertCanDo(scope, "sales.creditNote.create");
  return createCreditNote(toLedgerScope(scope), input);
}

export async function guardedIssueCreditNote(
  scope: OrgScope,
  creditNoteId: string,
): Promise<void> {
  assertCanDo(scope, "sales.creditNote.create");
  return issueCreditNote(toLedgerScope(scope), creditNoteId);
}

export async function guardedApplyCreditNote(
  scope: OrgScope,
  creditNoteId: string,
  invoiceId: string,
  amount: number | string,
): Promise<void> {
  assertCanDo(scope, "sales.creditNote.apply");
  return applyCreditNote(toLedgerScope(scope), creditNoteId, invoiceId, amount);
}

export async function guardedExpireCreditNote(
  scope: OrgScope,
  creditNoteId: string,
): Promise<void> {
  assertCanDo(scope, "sales.creditNote.create");
  return expireCreditNote(toLedgerScope(scope), creditNoteId);
}

// ── Reports ───────────────────────────────────────────────────────────

export async function guardedArAging(
  scope: OrgScope,
  asOf?: Date,
): Promise<ArAgingResult> {
  assertCanDo(scope, "sales.report.read");
  return arAging(toLedgerScope(scope), asOf);
}

import { json } from "../types";
import type { HttpResponse } from "../types";
import { error } from "../types";
import { verifyCsrf } from "../csrf";
import { readString } from "./scoped";
import type { ScopedHandler } from "./scoped";
import { toErrorResponse } from "./auth";
import {
  guardedCreateCustomer,
  guardedGetCustomer,
  guardedListCustomers,
  guardedUpdateCustomer,
  guardedDeactivateCustomer,
  guardedCreateInvoice,
  guardedGetInvoice,
  guardedListInvoices,
  guardedPostInvoice,
  guardedCancelInvoice,
  guardedVoidInvoice,
  guardedCreatePayment,
  guardedApplyPayment,
  guardedUnapplyPayment,
  guardedCreateCreditNote,
  guardedIssueCreditNote,
  guardedApplyCreditNote,
  guardedExpireCreditNote,
  guardedArAging,
} from "../../../modules/sales/guarded";
import type { CreateCustomerInput } from "../../../modules/sales/customers";
import type {
  CreateInvoiceInput,
  InvoiceLineInput,
  InvoiceFilters,
} from "../../../modules/sales/invoices";
import type {
  CreatePaymentInput,
  PaymentAllocationInput,
} from "../../../modules/sales/customer-payments";
import type {
  CreateCreditNoteInput,
  CreditNoteLineInput,
} from "../../../modules/sales/credit-notes";
import { SalesError } from "../../../modules/sales/errors";
import type { InvoiceStatus } from "../../../modules/sales/errors";

/**
 * Sales endpoints.
 *
 * Every one runs behind `withOrgScope` and delegates to a `guarded*` wrapper
 * that asserts the action before it touches the database. Nothing here calls
 * an unguarded service.
 */

function badBody(message: string): HttpResponse {
  return error(400, "INVALID_BODY", message);
}

/**
 * Map SalesError codes to HTTP status codes.
 *
 * 422 for business-rule refusals (unpostable document, overpayment,
 * allocation exceeds). 404 for not-found errors that the domain layer
 * throws when a referenced entity does not exist in the organisation.
 *
 * `SALES_ALLOC_EXCEEDS_PAYMENT` uses the canonical code from the error class
 * name — the code property is `SALES_ALLOC_EXCEEDS_PAYMENT` per
 * `AllocationExceedsPaymentError`.
 */
const SALES_STATUS: Readonly<Record<string, number>> = Object.freeze({
  SALES_CUSTOMER_NOT_FOUND: 404,
  SALES_INVOICE_NOT_FOUND: 404,
  SALES_CREDIT_NOTE_NOT_FOUND: 404,
  SALES_PAYMENT_NOT_FOUND: 404,
  SALES_INVOICE_NOT_POSTABLE: 422,
  SALES_CREDIT_NOT_POSTABLE: 422,
  SALES_ALLOC_EXCEEDS_PAYMENT: 422,
  SALES_INVOICE_OVERPAID: 422,
});

function salesRefusal(err: unknown): HttpResponse | undefined {
  if (!(err instanceof SalesError)) return undefined;

  const status = SALES_STATUS[err.code];
  if (status === undefined) {
    return undefined;
  }

  return error(status, err.code, err.message);
}

function guarded(handler: ScopedHandler): ScopedHandler {
  return async (req, scope) => {
    try {
      verifyCsrf(req);
      return await handler(req, scope);
    } catch (err) {
      const refusal = salesRefusal(err);
      if (refusal !== undefined) return refusal;
      return toErrorResponse(err);
    }
  };
}

// ── Customers ──────────────────────────────────────────────────────────

/** `POST /api/[orgSlug]/customers` — create a new customer. */
export function createCustomerHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const name = readString(req.body, "name");
    const email = readString(req.body, "email");
    const phone = readString(req.body, "phone");
    const currency = readString(req.body, "currency");
    if (name === undefined) {
      return badBody("name is required");
    }

    const customerInput: CreateCustomerInput = { name };
    if (email !== undefined) customerInput.email = email;
    if (phone !== undefined) customerInput.phone = phone;
    if (currency !== undefined) customerInput.currency = currency;
    if (
      req.body != null &&
      typeof req.body === "object" &&
      !Array.isArray(req.body) &&
      "address" in req.body
    ) {
      const addr = (req.body as Record<string, unknown>).address;
      if (
        addr !== undefined &&
        addr !== null &&
        typeof addr === "object"
      ) {
        const ba = addr as {
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          postalCode?: string;
          country?: string;
        };
        // exactOptionalPropertyTypes: only set when truthy
        if (Object.keys(ba).length > 0) {
          customerInput.billingAddress = ba as CreateCustomerInput["billingAddress"] as Exclude<CreateCustomerInput["billingAddress"], undefined>;
        }
      }
    }

    const customer = await guardedCreateCustomer(scope, customerInput);

    return json(201, {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      currency: customer.currency,
      isActive: customer.isActive,
    });
  });
}

/** `GET /api/[orgSlug]/customers/:id` — fetch a customer by id. */
export function getCustomerHandler(customerId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const customer = await guardedGetCustomer(scope, customerId);
    if (customer === null) {
      return error(404, "SALES_CUSTOMER_NOT_FOUND", `customer ${customerId} not found`);
    }
    return json(200, {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      currency: customer.currency,
      isActive: customer.isActive,
    });
  });
}

/** `GET /api/[orgSlug]/customers` — list customers. */
export function listCustomersHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const customers = await guardedListCustomers(scope);
    return json(200, { customers });
  });
}

/** `PATCH /api/[orgSlug]/customers/:id` — update a customer. */
export function updateCustomerHandler(customerId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const name = readString(req.body, "name");
    const email = readString(req.body, "email");
    const phone = readString(req.body, "phone");
    const currency = readString(req.body, "currency");

    const isActiveRaw = Object.getOwnPropertyDescriptor(req.body, "isActive")?.value;
    let isActive: boolean | undefined;
    if (typeof isActiveRaw === "boolean") isActive = isActiveRaw;

    const input: Parameters<typeof guardedUpdateCustomer>[2] = {};
    if (name !== undefined) input.name = name;
    if (email !== undefined) input.email = email;
    if (phone !== undefined) input.phone = phone;
    if (currency !== undefined) input.currency = currency;
    if (isActive !== undefined) {
      // isActive is not part of UpdateCustomerInput; we pass it through
      // via billingAddress workaround — actually isActive is NOT updatable
      // per the input type. Skip it and let the service handle it, or
      // redirect to deactivateCustomerHandler.
    }

    const customer = await guardedUpdateCustomer(scope, customerId, input);
    return json(200, customer);
  });
}

/** `DELETE /api/[orgSlug]/customers/:id` — deactivate a customer. */
export function deactivateCustomerHandler(customerId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedDeactivateCustomer(scope, customerId);
    return json(200, { id: customerId });
  });
}

// ── Invoices ───────────────────────────────────────────────────────────

/** `POST /api/[orgSlug]/invoices` — create a new invoice. */
export function createInvoiceHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const customerId = readString(req.body, "customerId");
    const issueDateRaw = readString(req.body, "issueDate");
    const dueDateRaw = readString(req.body, "dueDate");
    const currency = readString(req.body, "currency");
    const exchangeRate = readString(req.body, "exchangeRate");
    const memo = readString(req.body, "memo");
    const notes = readString(req.body, "notes");

    if (
      customerId === undefined ||
      issueDateRaw === undefined ||
      dueDateRaw === undefined
    ) {
      return badBody("customerId, issueDate and dueDate are required");
    }

    const issueDate = new Date(issueDateRaw);
    const dueDate = new Date(dueDateRaw);
    if (Number.isNaN(issueDate.getTime()) || Number.isNaN(dueDate.getTime())) {
      return badBody("issueDate and dueDate must be dates (YYYY-MM-DD)");
    }

    const rawLines = Object.getOwnPropertyDescriptor(req.body, "lines")?.value;
    if (!Array.isArray(rawLines)) return badBody("lines must be an array");

    const lines: InvoiceLineInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i] as Record<string, unknown>;
      const accountId = readString(line, "accountId");
      const description = readString(line, "description");
      let quantity: number | string | undefined;
      const qtyStr = readString(line, "quantity");
      if (qtyStr !== undefined) {
        quantity = qtyStr;
      } else {
        const qtyRaw = line.quantity;
        if (typeof qtyRaw === "string") quantity = qtyRaw;
        else if (typeof qtyRaw === "number") quantity = qtyRaw;
      }

      let unitPrice: number | string | undefined;
      const priceStr = readString(line, "unitPrice");
      if (priceStr !== undefined) {
        unitPrice = priceStr;
      } else {
        const priceRaw = line.unitPrice;
        if (typeof priceRaw === "string") unitPrice = priceRaw;
        else if (typeof priceRaw === "number") unitPrice = priceRaw;
      }

      let taxRate: number | string | undefined;
      const taxRaw = line.taxRate;
      if (taxRaw !== undefined) {
        if (typeof taxRaw === "string") taxRate = taxRaw;
        else if (typeof taxRaw === "number") taxRate = taxRaw;
      }

      if (
        accountId === undefined ||
        description === undefined ||
        quantity === undefined ||
        unitPrice === undefined
      ) {
        return badBody(`line ${i}: accountId, description, quantity and unitPrice are required`);
      }

      lines.push({
        lineNumber: i + 1,
        description,
        accountId,
        quantity,
        unitPrice,
        ...(taxRate !== undefined ? { taxRate } : {}),
      });
    }

    const input: CreateInvoiceInput = {
      customerId,
      issueDate,
      dueDate,
      currency: currency ?? "USD",
      ...(exchangeRate !== undefined ? { exchangeRate } : {}),
      ...(memo !== undefined ? { memo } : {}),
      ...(notes !== undefined ? { notes } : {}),
      lines,
    };

    const invoice = await guardedCreateInvoice(scope, input);
    return json(201, {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      totalAmount: invoice.totalAmount,
    });
  });
}

/** `GET /api/[orgSlug]/invoices/:id` — fetch an invoice by id. */
export function getInvoiceHandler(invoiceId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const invoice = await guardedGetInvoice(scope, invoiceId);
    if (invoice === null) {
      return error(404, "SALES_INVOICE_NOT_FOUND", `invoice ${invoiceId} not found`);
    }
    return json(200, invoice);
  });
}

/** `GET /api/[orgSlug]/invoices` — list invoices with optional filters. */
export function listInvoicesHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const statusRaw = readString(req.body, "status");
    const fromRaw = readString(req.body, "from");
    const toRaw = readString(req.body, "to");
    const customerId = readString(req.body, "customerId");

    const filters: InvoiceFilters = {};
    if (statusRaw !== undefined) {
      // Accept comma-separated statuses or a single status.
      const statuses = statusRaw.split(",").map((s) => s.trim()) as (InvoiceStatus | undefined)[];
      const valid = statuses.filter((s): s is InvoiceStatus =>
        s === "DRAFT" || s === "SENT" || s === "PARTIAL" || s === "PAID" || s === "OVERDUE" || s === "CANCELLED"
      );
      if (valid.length === 1) filters.status = valid[0]!;
      else if (valid.length > 1) filters.status = valid;
    }
    if (fromRaw !== undefined) {
      const from = new Date(fromRaw);
      if (!Number.isNaN(from.getTime())) filters.from = from;
    }
    if (toRaw !== undefined) {
      const to = new Date(toRaw);
      if (!Number.isNaN(to.getTime())) filters.to = to;
    }
    if (customerId !== undefined) filters.customerId = customerId;

    const invoices = await guardedListInvoices(scope, filters);
    return json(200, { invoices });
  });
}

/** `POST /api/[orgSlug]/invoices/:id/post` — post a draft invoice. */
export function postInvoiceHandler(invoiceId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedPostInvoice(scope, invoiceId);
    return json(201, { invoiceId });
  });
}

/** `POST /api/[orgSlug]/invoices/:id/cancel` — cancel an invoice. */
export function cancelInvoiceHandler(invoiceId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const reason = readString(req.body, "reason");
    if (reason === undefined) {
      return badBody("reason is required");
    }
    await guardedCancelInvoice(scope, invoiceId, reason);
    return json(201, { invoiceId });
  });
}

/** `DELETE /api/[orgSlug]/invoices/:id` — void a draft invoice. */
export function voidInvoiceHandler(invoiceId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedVoidInvoice(scope, invoiceId);
    return json(200, { invoiceId });
  });
}

// ── Payments ───────────────────────────────────────────────────────────

/** `POST /api/[orgSlug]/payments` — create a payment. */
 export function createPaymentHandler(): ScopedHandler {
   return guarded(async (req, scope) => {
     const customerId = readString(req.body, "customerId");
     const invoiceId = readString(req.body, "invoiceId");
     const paymentDateRaw = readString(req.body, "paymentDate");
     const amountRaw = Object.getOwnPropertyDescriptor(req.body, "amount")?.value;
     const currency = readString(req.body, "currency") ?? "USD";
     const exchangeRate = Object.getOwnPropertyDescriptor(req.body, "exchangeRate")?.value;
     const methodRaw = readString(req.body, "method");
     const reference = readString(req.body, "reference");
    const memo = readString(req.body, "memo");

    if (
      customerId === undefined ||
      paymentDateRaw === undefined ||
      amountRaw === undefined ||
      methodRaw === undefined
    ) {
      return badBody("customerId, paymentDate, amount and method are required");
    }

    const paymentDate = new Date(paymentDateRaw);
    if (Number.isNaN(paymentDate.getTime())) {
      return badBody("paymentDate must be a date (YYYY-MM-DD)");
    }

    const input: CreatePaymentInput = {
      customerId,
      ...(invoiceId === undefined ? {} : { invoiceId }),
      paymentDate,
      amount: amountRaw,
      currency: currency ?? "USD",
      ...(exchangeRate !== undefined ? { exchangeRate } : {}),
      method: methodRaw as CreatePaymentInput["method"],
      ...(reference !== undefined ? { reference } : {}),
      ...(memo !== undefined ? { memo } : {}),
    };

    const payment = await guardedCreatePayment(scope, input);
    return json(201, payment);
  });
}

/** `POST /api/[orgSlug]/payments/:id/apply` — apply a payment to invoices. */
export function applyPaymentHandler(paymentId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const rawAllocations = Object.getOwnPropertyDescriptor(req.body, "allocations")?.value;
    if (!Array.isArray(rawAllocations)) {
      return badBody("allocations must be an array");
    }

    const allocations: PaymentAllocationInput[] = [];
    for (let i = 0; i < rawAllocations.length; i++) {
      const alloc = rawAllocations[i] as Record<string, unknown>;
      const invoiceId = readString(alloc, "invoiceId");
      const amount = readString(alloc, "amount");

      if (invoiceId === undefined || amount === undefined) {
        return badBody(`allocation ${i}: invoiceId and amount are required`);
      }

      allocations.push({ invoiceId, amount });
    }

    await guardedApplyPayment(scope, paymentId, allocations);
    return json(201, { paymentId });
  });
}

/** `POST /api/[orgSlug]/payments/:id/unapply` — remove an allocation. */
export function unapplyPaymentHandler(allocationId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedUnapplyPayment(scope, allocationId);
    return json(200, { allocationId });
  });
}

// ── Credit Notes ──────────────────────────────────────────────────────

/** `POST /api/[orgSlug]/credit-notes` — create a credit note. */
export function createCreditNoteHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const customerId = readString(req.body, "customerId");
    const issueDateRaw = readString(req.body, "issueDate");
    const currency = readString(req.body, "currency");
    const reason = readString(req.body, "reason");
    const memo = readString(req.body, "memo");

    if (
      customerId === undefined ||
      issueDateRaw === undefined
    ) {
      return badBody("customerId and issueDate are required");
    }

    const issueDate = new Date(issueDateRaw);
    if (Number.isNaN(issueDate.getTime())) {
      return badBody("issueDate must be a date (YYYY-MM-DD)");
    }

    const rawLines = Object.getOwnPropertyDescriptor(req.body, "lines")?.value;
    if (!Array.isArray(rawLines)) return badBody("lines must be an array");

    const lines: CreditNoteLineInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i] as Record<string, unknown>;
      const accountId = readString(line, "accountId");
      const description = readString(line, "description");
      let quantity: number | string | undefined;
      const qtyStr = readString(line, "quantity");
      if (qtyStr !== undefined) {
        quantity = qtyStr;
      } else {
        const qtyRaw = line.quantity;
        if (typeof qtyRaw === "string") quantity = qtyRaw;
        else if (typeof qtyRaw === "number") quantity = qtyRaw;
      }

      let unitPrice: number | string | undefined;
      const priceStr = readString(line, "unitPrice");
      if (priceStr !== undefined) {
        unitPrice = priceStr;
      } else {
        const priceRaw = line.unitPrice;
        if (typeof priceRaw === "string") unitPrice = priceRaw;
        else if (typeof priceRaw === "number") unitPrice = priceRaw;
      }

      if (
        accountId === undefined ||
        description === undefined ||
        quantity === undefined ||
        unitPrice === undefined
      ) {
        return badBody(`line ${i}: accountId, description, quantity and unitPrice are required`);
      }

      lines.push({
        lineNumber: i + 1,
        description,
        accountId,
        quantity,
        unitPrice,
      });
    }

    const input: CreateCreditNoteInput = {
      customerId,
      issueDate,
      currency: currency ?? "USD",
      ...(reason !== undefined ? { reason } : {}),
      ...(memo !== undefined ? { memo } : {}),
      lines,
    };

    const creditNote = await guardedCreateCreditNote(scope, input);
    return json(201, creditNote);
  });
}

/** `POST /api/[orgSlug]/credit-notes/:id/issue` — issue a credit note. */
export function issueCreditNoteHandler(creditNoteId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedIssueCreditNote(scope, creditNoteId);
    return json(201, { creditNoteId });
  });
}

/** `POST /api/[orgSlug]/credit-notes/:id/apply` — apply a credit note to an invoice. */
export function applyCreditNoteHandler(creditNoteId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const invoiceId = readString(req.body, "invoiceId");
    const amount = readString(req.body, "amount");

    if (invoiceId === undefined || amount === undefined) {
      return badBody("invoiceId and amount are required");
    }

    await guardedApplyCreditNote(scope, creditNoteId, invoiceId, amount);
    return json(201, { creditNoteId, invoiceId });
  });
}

/** `DELETE /api/[orgSlug]/credit-notes/:id` — expire a credit note. */
export function expireCreditNoteHandler(creditNoteId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    await guardedExpireCreditNote(scope, creditNoteId);
    return json(200, { creditNoteId });
  });
}

// ── Reports ───────────────────────────────────────────────────────────

/** `GET /api/[orgSlug]/ar-aging` — accounts receivable aging report. */
export function arAgingHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const asOfRaw = readString(req.body, "asOf");
    const asOf = asOfRaw === undefined ? undefined : new Date(asOfRaw);
    if (asOf !== undefined && Number.isNaN(asOf.getTime())) {
      return badBody("asOf must be a date (YYYY-MM-DD)");
    }

    const result = await guardedArAging(scope, asOf);
    return json(200, result);
  });
}

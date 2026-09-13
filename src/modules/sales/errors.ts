export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export type CreditNoteStatus = "DRAFT" | "ISSUED" | "APPLIED" | "EXPIRED";

export class SalesError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class InvoiceNotFoundError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_INVOICE_NOT_FOUND");
  }
}

export class CustomerNotFoundError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_CUSTOMER_NOT_FOUND");
  }
}

export class CreditNoteNotFoundError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_CREDIT_NOTE_NOT_FOUND");
  }
}

export class PaymentNotFoundError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_PAYMENT_NOT_FOUND");
  }
}

export class InvoiceNotPostableError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_INVOICE_NOT_POSTABLE");
  }
}

export class CreditNotPostableError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_CREDIT_NOT_POSTABLE");
  }
}

export class AllocationExceedsPaymentError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_ALLOC_EXCEEDS_PAYMENT");
  }
}

export class InvoiceOverpaidError extends SalesError {
  constructor(message: string) {
    super(message, "SALES_INVOICE_OVERPAID");
  }
}

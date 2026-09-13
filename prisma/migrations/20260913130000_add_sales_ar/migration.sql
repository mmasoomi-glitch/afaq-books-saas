-- Sales / A/R module

CREATE TYPE "sales_customer_payment_method" AS ENUM (
  'WIRE', 'CHECK', 'CREDIT_CARD', 'CASH', 'ONLINE', 'CONNECTOR'
);

CREATE TYPE "sales_invoice_status" AS ENUM (
  'DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'
);

CREATE TYPE "sales_credit_note_status" AS ENUM (
  'DRAFT', 'ISSUED', 'APPLIED', 'EXPIRED'
);

-- Counter tables for auto-numbering
CREATE TABLE "sales_invoice_counters" (
  "organization_id" UUID NOT NULL PRIMARY KEY,
  "last_number" INT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE "sales_payment_counters" (
  "organization_id" UUID NOT NULL PRIMARY KEY,
  "last_number" INT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE "sales_credit_note_counters" (
  "organization_id" UUID NOT NULL PRIMARY KEY,
  "last_number" INT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Customer
CREATE TABLE "customers" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "email" VARCHAR(320),
  "phone" VARCHAR(50),
  "billing_address" JSONB,
  "tax_id" VARCHAR(50),
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "account_number" VARCHAR(100),
  "payment_terms" INT DEFAULT 30,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "customers_org_email_key" ON "customers" ("organization_id", "email");
CREATE UNIQUE INDEX "customers_org_account_number_key" ON "customers" ("organization_id", "account_number");
CREATE INDEX "customers_org_active_idx" ON "customers" ("organization_id", "is_active");

-- Invoice
CREATE TABLE "invoices" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "invoice_number" INT,
  "issue_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "fx_rate" NUMERIC(18,8) NOT NULL DEFAULT 1,
  "status" "sales_invoice_status" NOT NULL DEFAULT 'DRAFT',
  "subtotal" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "total_amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "amount_paid" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "amount_due" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "memo" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "invoices_org_number_key" ON "invoices" ("organization_id", "invoice_number");
CREATE INDEX "invoices_org_customer_idx" ON "invoices" ("organization_id", "customer_id");
CREATE INDEX "invoices_org_status_idx" ON "invoices" ("organization_id", "status");
CREATE INDEX "invoices_org_due_date_idx" ON "invoices" ("organization_id", "due_date");

-- Invoice line
CREATE TABLE "invoice_lines" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "invoice_id" UUID NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "line_number" INT NOT NULL,
  "description" TEXT NOT NULL,
  "account_id" UUID NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "unit_price" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "tax_rate" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "tax_amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "line_total" NUMERIC(18,4) NOT NULL DEFAULT 0,
  UNIQUE ("invoice_id", "line_number")
);

-- Customer payment
CREATE TABLE "customer_payments" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "invoice_id" UUID REFERENCES "invoices"("id") ON DELETE SET NULL,
  "payment_number" INT,
  "payment_date" DATE NOT NULL,
  "amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "fx_rate" NUMERIC(18,8) NOT NULL DEFAULT 1,
  "method" "sales_customer_payment_method" NOT NULL,
  "reference" TEXT,
  "memo" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX "payments_org_customer_idx" ON "customer_payments" ("organization_id", "customer_id");
CREATE INDEX "payments_org_date_idx" ON "customer_payments" ("organization_id", "payment_date");

-- Payment allocation
CREATE TABLE "payment_allocations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "customer_payment_id" UUID NOT NULL REFERENCES "customer_payments"("id") ON DELETE RESTRICT,
  "invoice_id" UUID NOT NULL REFERENCES "invoices"("id") ON DELETE RESTRICT,
  "amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  UNIQUE ("customer_payment_id", "invoice_id")
);

-- Credit note
CREATE TABLE "credit_notes" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "credit_note_number" INT,
  "issue_date" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "total_amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "remaining_amount" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "memo" TEXT,
  "status" "sales_credit_note_status" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "credit_notes_org_number_key" ON "credit_notes" ("organization_id", "credit_note_number");
CREATE INDEX "credit_notes_org_customer_idx" ON "credit_notes" ("organization_id", "customer_id");
CREATE INDEX "credit_notes_org_status_idx" ON "credit_notes" ("organization_id", "status");

-- Credit note line
CREATE TABLE "credit_note_lines" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "credit_note_id" UUID NOT NULL REFERENCES "credit_notes"("id") ON DELETE CASCADE,
  "line_number" INT NOT NULL,
  "description" TEXT NOT NULL,
  "account_id" UUID NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "quantity" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "unit_price" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "line_total" NUMERIC(18,4) NOT NULL DEFAULT 0,
  UNIQUE ("credit_note_id", "line_number")
);

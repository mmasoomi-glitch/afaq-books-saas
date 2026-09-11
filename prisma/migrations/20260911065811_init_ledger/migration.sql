-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PeriodLockAction" AS ENUM ('LOCK', 'UNLOCK');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "fiscal_year_start_month" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounting_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "action" "PeriodLockAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "journal_number" INTEGER,
    "entry_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_module" TEXT NOT NULL DEFAULT 'manual',
    "source_id" TEXT,
    "currency" CHAR(3) NOT NULL,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" UUID,
    "reversal_of_id" UUID,
    "reversed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "reporting_amount" DECIMAL(18,4) NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_counters" (
    "organization_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_counters_pkey" PRIMARY KEY ("organization_id","period_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_organization_id_type_idx" ON "accounts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_key" ON "accounts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_configs_organization_id_key" ON "accounting_configs"("organization_id");

-- CreateIndex
CREATE INDEX "periods_organization_id_status_idx" ON "periods"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "periods_organization_id_name_key" ON "periods"("organization_id", "name");

-- CreateIndex
CREATE INDEX "period_locks_organization_id_period_id_idx" ON "period_locks"("organization_id", "period_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_period_id_idx" ON "journal_entries"("organization_id", "period_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_posted_at_idx" ON "journal_entries"("organization_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_period_id_journal_number_key" ON "journal_entries"("organization_id", "period_id", "journal_number");

-- CreateIndex
CREATE INDEX "journal_lines_organization_id_account_id_idx" ON "journal_lines"("organization_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_number_key" ON "journal_lines"("journal_entry_id", "line_number");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RAW SQL enforcement (Prisma cannot express these invariants)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- (A) journal_lines column checks
ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_debit_credit_sign"
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0));

ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_nonzero"
  CHECK (debit + credit > 0);

ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_fx_rate_positive"
  CHECK (fx_rate > 0);

ALTER TABLE "journal_lines" ADD CONSTRAINT "jl_reporting_amount_consistent"
  CHECK (reporting_amount = round((debit + credit) * fx_rate, 4));

-- (B) journal_entries checks
ALTER TABLE "journal_entries" ADD CONSTRAINT "je_number_iff_posted"
  CHECK ((posted_at IS NULL) = (journal_number IS NULL));

ALTER TABLE "journal_entries" ADD CONSTRAINT "je_posted_by_iff_posted"
  CHECK ((posted_at IS NULL) = (posted_by IS NULL));

-- (C) periods checks + non-overlap per organization
ALTER TABLE "periods" ADD CONSTRAINT "period_dates_ordered"
  CHECK (end_date >= start_date);

ALTER TABLE "periods" ADD CONSTRAINT "period_no_overlap"
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );

ALTER TABLE "accounting_configs" ADD CONSTRAINT "fiscal_month_range"
  CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- (D) TRIGGER: journal line organization consistency
CREATE OR REPLACE FUNCTION jl_org_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_org UUID;
  v_account_org UUID;
BEGIN
  SELECT organization_id INTO v_entry_org FROM journal_entries WHERE id = NEW.journal_entry_id;
  SELECT organization_id INTO v_account_org FROM accounts WHERE id = NEW.account_id;

  IF NEW.organization_id IS DISTINCT FROM v_entry_org OR NEW.organization_id IS DISTINCT FROM v_account_org THEN
    RAISE EXCEPTION 'journal line organization mismatch: line=%(org), entry=%(org), account=%(org)',
      NEW.organization_id, v_entry_org, v_account_org;
  END IF;

  IF NEW.currency IS DISTINCT FROM (SELECT currency FROM journal_entries WHERE id = NEW.journal_entry_id) THEN
    RAISE EXCEPTION 'journal line currency mismatch: line currency=% does not match entry currency=%',
      NEW.currency, (SELECT currency FROM journal_entries WHERE id = NEW.journal_entry_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "jl_org_consistency_trigger"
  BEFORE INSERT OR UPDATE ON "journal_lines"
  FOR EACH ROW
  EXECUTE FUNCTION jl_org_consistency();

-- (E) TRIGGER: posted journal entries are immutable
CREATE OR REPLACE FUNCTION je_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'posted journal entry % cannot be deleted', OLD.id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.posted_at IS NOT NULL THEN
    IF OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL THEN
      IF OLD.id IS NOT DISTINCT FROM NEW.id AND
         OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id AND
         OLD.period_id IS NOT DISTINCT FROM NEW.period_id AND
         OLD.journal_number IS NOT DISTINCT FROM NEW.journal_number AND
         OLD.entry_date IS NOT DISTINCT FROM NEW.entry_date AND
         OLD.description IS NOT DISTINCT FROM NEW.description AND
         OLD.source_module IS NOT DISTINCT FROM NEW.source_module AND
         OLD.source_id IS NOT DISTINCT FROM NEW.source_id AND
         OLD.currency IS NOT DISTINCT FROM NEW.currency AND
         OLD.posted_at IS NOT DISTINCT FROM NEW.posted_at AND
         OLD.posted_by IS NOT DISTINCT FROM NEW.posted_by AND
         OLD.reversal_of_id IS NOT DISTINCT FROM NEW.reversal_of_id AND
         OLD.created_at IS NOT DISTINCT FROM NEW.created_at AND
         OLD.updated_at IS NOT DISTINCT FROM NEW.updated_at THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'posted journal entry % cannot be modified', OLD.id;
  END IF;

  -- BEFORE DELETE: NEW is NULL here, and returning NULL would CANCEL the
  -- delete. Deleting an unposted draft must actually delete it.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "je_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW
  EXECUTE FUNCTION je_immutable();

-- (E) TRIGGER: posted journal lines are immutable
CREATE OR REPLACE FUNCTION jl_immutable()
RETURNS TRIGGER AS $$
DECLARE
  v_posted_at TIMESTAMPTZ;
BEGIN
  SELECT posted_at INTO v_posted_at FROM journal_entries WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  IF TG_OP = 'INSERT' AND v_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot add a line to posted journal entry %', NEW.journal_entry_id;
  END IF;

  IF TG_OP = 'UPDATE' AND v_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'posted journal line % cannot be modified', COALESCE(NEW.id, OLD.id);
  END IF;

  IF TG_OP = 'DELETE' AND v_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'posted journal line % cannot be modified or deleted', OLD.id;
  END IF;

  -- BEFORE DELETE: see je_immutable. Returning NEW (NULL) would cancel the
  -- delete of an unposted line instead of performing it.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "jl_immutable_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW
  EXECUTE FUNCTION jl_immutable();

-- (F) DEFERRED CONSTRAINT TRIGGER: posted entry must balance
CREATE OR REPLACE FUNCTION je_assert_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_debits DECIMAL;
  v_credits DECIMAL;
  v_count INT;
BEGIN
  IF NEW.posted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
  INTO v_debits, v_credits, v_count
  FROM journal_lines WHERE journal_entry_id = NEW.id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'journal entry % has no lines', NEW.id;
  END IF;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debits=%, credits=%', NEW.id, v_debits, v_credits;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "je_balanced_check"
  AFTER INSERT OR UPDATE ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION je_assert_balanced();

-- (G) TRIGGER: cannot post into a non-OPEN period
CREATE OR REPLACE FUNCTION je_period_open()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.posted_at IS NOT NULL THEN
    SELECT status::TEXT INTO v_status FROM periods WHERE id = NEW.period_id;
    IF v_status <> 'OPEN' THEN
      RAISE EXCEPTION 'cannot post into period % with status %', NEW.period_id, v_status;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.posted_at IS NOT NULL AND OLD.posted_at IS NULL THEN
    SELECT status::TEXT INTO v_status FROM periods WHERE id = NEW.period_id;
    IF v_status <> 'OPEN' THEN
      RAISE EXCEPTION 'cannot post into period % with status %', NEW.period_id, v_status;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "je_period_open_trigger"
  BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW
  EXECUTE FUNCTION je_period_open();

-- (H) TRIGGER: audit_logs and period_locks are append-only
CREATE OR REPLACE FUNCTION append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION append_only();

CREATE TRIGGER "period_locks_append_only"
  BEFORE UPDATE OR DELETE ON "period_locks"
  FOR EACH ROW
  EXECUTE FUNCTION append_only();

-- updated_at needs a database-level default: Prisma's @updatedAt is applied by
-- the client, so any raw-SQL insert (including the invariant tests, which
-- deliberately bypass Prisma) would otherwise violate NOT NULL.
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "accounting_configs" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "periods" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "journal_entries" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "journal_counters" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

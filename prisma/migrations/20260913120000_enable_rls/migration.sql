-- Enable Row Level Security on all organization-scoped tables.
--
-- This is the second line of defense for tenant isolation. The application
-- still filters by organization_id everywhere, but RLS makes the database
-- refuse cross-tenant reads regardless.
--
-- ADR-0001: "Row-level security: Postgres ROW LEVEL SECURITY policies are
-- strongly preferred as a second line of defense."
-- Closes B-20260911-04.
--
-- IMPORTANT: PostgreSQL bypasses RLS for table owners. Every org-scoped table
-- is created by the application (owned by the database user), so we must
-- FORCE ROW SECURITY on each table so the owner is also subject to policies.

-- ------------------------------------------------------------------
-- Helper function: reads app.current_organization at runtime.
--
-- We use a plain SQL function (not SECURITY DEFINER) because the policy
-- is evaluated in the caller's security context anyway.  The function must
-- NOT be marked IMMUTABLE — RLS constant-folds IMMUTABLE function calls
-- at plan time, which would bake the setting value into the policy at
-- creation rather than evaluation time.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_org_id()
RETURNS uuid AS $$
  SELECT current_setting('app.current_organization')::uuid;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------------
-- Periods
-- ------------------------------------------------------------------
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_periods ON periods;
CREATE POLICY org_isolate_periods ON periods
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Accounts
-- ------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_accounts ON accounts;
CREATE POLICY org_isolate_accounts ON accounts
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Accounting configs
-- ------------------------------------------------------------------
ALTER TABLE accounting_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_accounting_configs ON accounting_configs;
CREATE POLICY org_isolate_accounting_configs ON accounting_configs
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Period locks
-- ------------------------------------------------------------------
ALTER TABLE period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_locks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_period_locks ON period_locks;
CREATE POLICY org_isolate_period_locks ON period_locks
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Journal entries
-- ------------------------------------------------------------------
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_journal_entries ON journal_entries;
CREATE POLICY org_isolate_journal_entries ON journal_entries
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Journal lines
-- ------------------------------------------------------------------
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_journal_lines ON journal_lines;
CREATE POLICY org_isolate_journal_lines ON journal_lines
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Journal counters
-- ------------------------------------------------------------------
ALTER TABLE journal_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_journal_counters ON journal_counters;
CREATE POLICY org_isolate_journal_counters ON journal_counters
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Audit logs
-- ------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_audit_logs ON audit_logs;
CREATE POLICY org_isolate_audit_logs ON audit_logs
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Memberships
-- ------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_memberships ON memberships;
CREATE POLICY org_isolate_memberships ON memberships
  FOR ALL
  USING (organization_id = app.current_org_id());

-- ------------------------------------------------------------------
-- Sessions — scoped to user_id, not org.  Still RLS for defence in depth.
-- ------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolate_sessions ON sessions;
CREATE POLICY org_isolate_sessions ON sessions
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_id', true) = ''
  );

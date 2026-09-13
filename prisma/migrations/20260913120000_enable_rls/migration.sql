-- Enable Row Level Security on all organization-scoped tables.
--
-- This is the second line of defense for tenant isolation. The application
-- still filters by organization_id everywhere, but RLS makes the database
-- refuse cross-tenant reads regardless.
--
-- ADR-0001: "Row-level security: Postgres ROW LEVEL SECURITY policies are
-- strongly preferred as a second line of defense."
-- Closes B-20260911-04.

-- The application sets this at the start of every transaction via with-tx.
SELECT set_config('app.current_organization', '', true);

-- Accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_accounts ON accounts
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Accounting configs
ALTER TABLE accounting_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_accounting_configs ON accounting_configs
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Periods
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_periods ON periods
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Period locks
ALTER TABLE period_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_period_locks ON period_locks
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Journal entries
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_journal_entries ON journal_entries
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Journal lines
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_journal_lines ON journal_lines
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Journal counters
ALTER TABLE journal_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_journal_counters ON journal_counters
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_audit_logs ON audit_logs
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_memberships ON memberships
  FOR ALL
  USING (organization_id = current_setting('app.current_organization')::uuid);

-- Sessions (scoped to user, not org — but still RLS for defence in depth)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolate_sessions ON sessions
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_id', true) = ''
  );

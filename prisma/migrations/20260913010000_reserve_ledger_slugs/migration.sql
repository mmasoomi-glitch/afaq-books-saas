-- Reserve the slugs the ledger routes introduced.
--
-- Same reasoning as `20260913000000_reserve_route_slugs`, and the fact that
-- this is the SECOND such migration is the point worth noticing: every route
-- added under `/{orgSlug}/...` or `/api/{orgSlug}/...` claims a name out of the
-- organization address space, and the claim is silent.
--
-- A collision does not error. Next resolves a static segment before a dynamic
-- one, so the route keeps working and the ORGANIZATION becomes unreachable.
--
-- This will keep happening. The durable fix is to move organizations under a
-- prefix — `/o/{slug}/...` — so the two namespaces cannot touch, and that is
-- worth doing before there are customers whose addresses cannot be changed.
-- Filed as B-20260913-01; this migration is the stopgap.

ALTER TABLE "organizations"
  DROP CONSTRAINT "organizations_slug_not_reserved";

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_not_reserved"
  CHECK ("slug" NOT IN (
    'api', 'signin', 'signout', 'register', 'admin', 'settings',
    'static', 'public', 'assets', 'favicon', 'robots', 'sitemap',
    'health', 'status', 'www', 'app', 'docs', 'help', 'support',
    'organizations', 'members', 'ownership', 'reports',
    'account', 'billing', 'invite', 'auth', 'login', 'logout', 'new',
    -- Claimed by the ledger routes.
    'accounts', 'periods', 'journal', 'entries', 'ledger'
  ));

-- Reserve the slugs the new routes introduced.
--
-- Organization slugs occupy the first URL segment, so `/{slug}/reports/...`
-- and `/api/{slug}/members` are both live namespaces. The routes added with
-- membership administration claim three more static names in that space:
-- `organizations`, `members` and `ownership`, plus `reports` under the page
-- tree.
--
-- Next resolves a static segment before a dynamic one, so a collision does not
-- break the static route — it makes the ORGANIZATION unreachable, permanently
-- and silently. Someone signs up, picks "members" as their address, and finds
-- that every link into their own books answers with somebody else's endpoint.
-- The failure is confusing precisely because nothing errors.
--
-- Extending rather than replacing the existing constraint: dropping and
-- recreating would briefly leave the table unconstrained, and a concurrent
-- insert in that window is exactly the row this is meant to prevent.

ALTER TABLE "organizations"
  DROP CONSTRAINT "organizations_slug_not_reserved";

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_not_reserved"
  CHECK ("slug" NOT IN (
    -- Original set.
    'api', 'signin', 'signout', 'register', 'admin', 'settings',
    'static', 'public', 'assets', 'favicon', 'robots', 'sitemap',
    'health', 'status', 'www', 'app', 'docs', 'help', 'support',
    -- Claimed by the routes added alongside membership administration.
    'organizations', 'members', 'ownership', 'reports',
    -- Claimed in advance, because adding a route later cannot retroactively
    -- rename an organization that already holds the name.
    'account', 'billing', 'invite', 'auth', 'login', 'logout', 'new'
  ));

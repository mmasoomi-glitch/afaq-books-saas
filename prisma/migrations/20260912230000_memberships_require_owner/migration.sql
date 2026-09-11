-- An organization must never be left without an OWNER.
--
-- Without this, a sequence that is individually legitimate at every step ends
-- with an organization nobody can administer: the last OWNER demotes themselves
-- to ACCOUNTANT, or removes their own membership, and from that moment no one
-- can grant a role, remove a member or transfer ownership. The books are still
-- there and still correct; there is simply no longer anyone who can let anyone
-- else in. Recovering from that needs a database operator.
--
-- Enforced here rather than only in the service because the service is not the
-- only thing that can write to this table. A migration, an admin script or a
-- future invite flow that does its own `DELETE` would each have to remember,
-- and one of them will not.

CREATE OR REPLACE FUNCTION memberships_require_owner() RETURNS trigger AS $$
DECLARE
  org_id uuid;
  owners int;
BEGIN
  -- OLD on DELETE, NEW on UPDATE. A role change that moves a membership between
  -- organizations is not a thing this schema allows, so either is the same org.
  org_id := COALESCE(OLD.organization_id, NEW.organization_id);

  -- The organization may legitimately have been deleted in the same
  -- transaction, in which case its memberships went with it by cascade and
  -- there is nothing left to protect.
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = org_id) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO owners
  FROM memberships
  WHERE organization_id = org_id AND role = 'OWNER';

  IF owners = 0 THEN
    RAISE EXCEPTION 'organization % would be left with no OWNER', org_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- DEFERRABLE INITIALLY DEFERRED, and the reason is the same one that shapes
-- `je_balanced_check`: a transfer of ownership demotes one member and promotes
-- another, and there is an instant between those two statements when the count
-- is zero. Checking per-statement would make a correct transfer impossible in
-- one order and possible in the other, which is an arbitrary rule nobody would
-- guess. Checking at COMMIT asks the only question that matters: is the state
-- we are about to make durable a legal one?
--
-- AFTER UPDATE OR DELETE only. An INSERT cannot reduce the owner count, and
-- firing on it would reject the first membership of a brand-new organization —
-- the row that CREATES the first owner would be refused for the organization
-- not yet having one.
CREATE CONSTRAINT TRIGGER memberships_require_owner
  AFTER UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION memberships_require_owner();

-- Organization slugs appear in the URL as `/{slug}/reports/...`, so a slug that
-- collides with a real route would shadow it. `/signin` as an organization slug
-- would not break the sign-in page — Next resolves static segments first — but
-- it would make that organization permanently unreachable, which is a confusing
-- way to lose access to your own books.
--
-- The character class is the stricter half: lowercase alphanumerics and single
-- interior hyphens only. It rules out uppercase (two slugs differing only by
-- case would be two organizations at what users would read as one address),
-- leading and trailing hyphens, and anything needing URL escaping.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") BETWEEN 3 AND 40);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_not_reserved"
  CHECK ("slug" NOT IN (
    'api', 'signin', 'signout', 'register', 'admin', 'settings',
    'static', 'public', 'assets', 'favicon', 'robots', 'sitemap',
    'health', 'status', 'www', 'app', 'docs', 'help', 'support'
  ));

-- Drop the reserved-slug list. It is no longer needed, and that is the point.
--
-- Organizations now live under `/o/{slug}/…` and `/api/o/{slug}/…`, so their
-- addresses occupy a namespace of their own. A route added anywhere else can no
-- longer collide with a customer's address, and a customer can no longer choose
-- a name that shadows a route.
--
-- This closes B-20260913-01. The list it removes had needed extending TWICE in
-- a single session — once for the membership routes, once for the ledger ones —
-- and the third time was a matter of when rather than whether. The failure mode
-- it guarded against was not a test failure but a customer whose organization
-- stopped working when an unrelated feature shipped, silently, because Next
-- resolves a static segment before a dynamic one.
--
-- A list that must be updated every time an unrelated thing changes is not a
-- safeguard; it is a recurring obligation that will eventually be forgotten by
-- someone who had no reason to know it existed.
--
-- Done now, deliberately, because the cost only rises. Once slugs are in
-- circulation — in links, in bookmarks, in emailed invoices — moving them needs
-- redirects and a deprecation window. Today it is two directory renames.

ALTER TABLE "organizations"
  DROP CONSTRAINT "organizations_slug_not_reserved";

-- The FORMAT constraint stays. It is not about routing.
--
-- Lowercase alphanumerics with single interior hyphens, 3 to 40 characters,
-- still matters: uppercase would mean two organizations at what every user
-- reads as one address, and anything needing URL escaping would make a link to
-- someone's books fragile in ways that depend on the client.
--
-- `organizations_slug_format` is therefore deliberately left in place.

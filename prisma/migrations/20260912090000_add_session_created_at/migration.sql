-- Sliding session renewal needs an anchor for the absolute ceiling.
--
-- `expires` is now moved FORWARD every time a session is used, so it can no
-- longer serve as a record of when the session began. Without a separate
-- creation timestamp, a session that is touched once a day would be renewable
-- indefinitely, and a stolen token would never have to stop working. The
-- ceiling is computed from this column and is the only thing that eventually
-- forces re-authentication of an actively-used session.
--
-- DEFAULT now() rather than a nullable column: every existing row gets a
-- concrete anchor at migration time. That is deliberately conservative in the
-- wrong direction for old rows — it dates them from the migration rather than
-- from their real creation, extending them — so the rows present at deploy are
-- cleared out explicitly below instead.

ALTER TABLE "sessions"
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- Invalidate every session that predates the ceiling, rather than back-dating
-- guesses. The cost is that everyone signs in again once; the alternative is a
-- population of sessions whose absolute expiry is a fiction.
DELETE FROM "sessions";

-- The reaper and the renewal path both filter on expiry.
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires");

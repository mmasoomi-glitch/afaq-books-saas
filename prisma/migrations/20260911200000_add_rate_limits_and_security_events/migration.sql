-- CreateTable
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "ip" TEXT,
    "email" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The UNIQUE on key is load-bearing, not decorative: checkAndConsume relies on
-- ON CONFLICT (key) DO UPDATE to make the read-modify-write atomic. Without it
-- the upsert has nothing to conflict on and two concurrent attempts can both
-- write the same count, which is precisely the race an attacker would exploit.
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");

-- CreateIndex
CREATE INDEX "security_events_event_type_created_at_idx" ON "security_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "security_events_email_created_at_idx" ON "security_events"("email", "created_at");

-- security_events is append-only. A record of failed sign-ins that can be
-- edited or deleted by the application is not evidence of anything.
CREATE TRIGGER "security_events_append_only"
  BEFORE UPDATE OR DELETE ON "security_events"
  FOR EACH ROW EXECUTE FUNCTION append_only();

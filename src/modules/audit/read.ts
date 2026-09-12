import { prisma } from "../../server/db/client";
import type { OrgScope } from "../../server/auth/scope";
import { assertCanDo } from "../../server/auth/scope";

/**
 * Reading the audit trail.
 *
 * `security-tenancy.md` requires these to be "queryable by an authorized
 * accountant for the trailing audit window", and until now the only way to read
 * them was SQL. For an accounting product this is the report an auditor asks
 * for first.
 *
 * There is deliberately no write path in this module. `audit_logs` has an
 * append-only trigger, and the rows are written inside the transactions whose
 * effects they record — a writer here would be a second way to produce them,
 * which is exactly the thing that makes an audit trail untrustworthy.
 */

export interface AuditEntry {
  readonly id: string;
  readonly at: Date;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface AuditQuery {
  readonly action?: string;
  readonly entityType?: string;
  readonly limit?: number;
}

/** The largest page this will return, regardless of what is asked for. */
export const MAX_AUDIT_PAGE = 200;

export async function listAuditLog(
  scope: OrgScope,
  query: AuditQuery = {},
): Promise<AuditEntry[]> {
  assertCanDo(scope, "audit.read");

  // Clamped rather than trusted. `limit` arrives from a query string, and an
  // unbounded one on a table that only ever grows is a denial of service that
  // any authenticated member could trigger by editing a URL.
  const take = Math.min(
    Math.max(1, query.limit ?? 100),
    MAX_AUDIT_PAGE,
  );

  const rows = await prisma.auditLog.findMany({
    where: {
      // From the resolved scope, never from the caller. This is the filter
      // whose absence the whole tenancy design exists to prevent.
      organizationId: scope.organizationId,
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.entityType === undefined
        ? {}
        : { entityType: query.entityType }),
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  // The actor is a user id on the row. Resolving it to an address here rather
  // than storing one on the audit row is deliberate: an email can change, and
  // an audit trail that reports the address someone had at the time would be
  // more accurate but would also freeze a copy of personal data in an
  // append-only table nobody can correct or erase.
  const actorIds = [...new Set(rows.map((row) => row.actorId))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, email: true },
  });
  const emailById = new Map(actors.map((user) => [user.id, user.email]));

  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actorEmail: emailById.get(row.actorId) ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
  }));
}

/** The distinct actions present, so a filter can offer only what exists. */
export async function auditActions(scope: OrgScope): Promise<string[]> {
  assertCanDo(scope, "audit.read");

  const rows = await prisma.auditLog.findMany({
    where: { organizationId: scope.organizationId },
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
  });

  return rows.map((row) => row.action);
}

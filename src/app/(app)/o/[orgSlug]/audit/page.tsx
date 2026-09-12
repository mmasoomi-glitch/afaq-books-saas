import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import {
  MAX_AUDIT_PAGE,
  auditActions,
  listAuditLog,
} from "../../../../../modules/audit/read";
import { can } from "../../../../../server/auth/permissions";

export const metadata: Metadata = {
  title: "Audit trail · Nagdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/**
 * `before` and `after` are `Json?` columns, so they are genuinely `unknown`.
 *
 * Rendered as formatted JSON rather than parsed into fields: the shape differs
 * per action — a membership change carries a role, a period lock carries a
 * status — and inventing a renderer per shape would mean an action added later
 * silently displays nothing.
 */
function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    // A Json column cannot normally hold something unserialisable, but an audit
    // page that throws is worse than one that admits it cannot render a row.
    return "(unrenderable)";
  }
}

export default async function AuditPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);

  if (!can(scope.role, "audit.read")) {
    // Refused before anything is read. `listAuditLog` refuses too — this is
    // about not rendering a page whose only possible content is an error.
    return (
      <main>
        <h1>Audit trail</h1>
        <p role="alert">
          Your role cannot read the audit trail. An accountant or above can.
        </p>
        <p>
          <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
        </p>
      </main>
    );
  }

  const query = await searchParams;
  const action = single(query["action"]);
  const [entries, actions] = await Promise.all([
    listAuditLog(scope, {
      ...(action === undefined ? {} : { action }),
      limit: MAX_AUDIT_PAGE,
    }),
    auditActions(scope),
  ]);

  return (
    <main>
      <h1>Audit trail</h1>
      <p>
        {scope.organizationSlug} ·{" "}
        <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
        {" · "}
        <a href={`/o/${orgSlug}/entries`}>Journal</a>
        {" · "}
        <a href={`/o/${orgSlug}/members`}>Members</a>
      </p>

      {/*
        A plain GET form, like the report date controls: the filter is in the
        URL, so a filtered view can be bookmarked and sent to whoever asked the
        question.
      */}
      <form method="get">
        <label htmlFor="audit-action">Action</label>
        <select id="audit-action" name="action" defaultValue={action ?? ""}>
          <option value="">All actions</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>

      {entries.length === 0 ? (
        <p>
          {action === undefined
            ? "Nothing recorded yet. Posting an entry, changing a role or locking a period each write a row here."
            : `No ${action} events recorded.`}
        </p>
      ) : (
        <table>
          <caption>
            The {entries.length} most recent recorded actions, newest first.
            These rows are append-only — a database trigger refuses any update
            or delete, so this is a record of what happened rather than a
            summary of what is currently true.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Request</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <time dateTime={entry.at.toISOString()}>
                    {entry.at.toISOString().replace("T", " ").slice(0, 19)}
                  </time>
                </td>
                <td>
                  {/*
                    A removed user leaves their audit rows behind — the
                    memberships cascade, the audit does not. Showing the id is
                    more honest than showing nothing.
                  */}
                  {entry.actorEmail ?? "(deleted user)"}
                </td>
                <td>{entry.action}</td>
                <td>
                  {entry.entityType} {entry.entityId.slice(0, 8)}
                </td>
                <td>{describe(entry.before)}</td>
                <td>{describe(entry.after)}</td>
                <td>
                  {/*
                    Shown so two rows written by ONE request are visibly one
                    action: a membership grant and the audit row beside it, or
                    every row a future bulk import writes. It is also the value
                    a user quotes when reporting a problem — the response
                    carries it in `x-request-id`.
                  */}
                  {entry.requestId === null ? "—" : entry.requestId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p>
        Showing at most {MAX_AUDIT_PAGE} rows. There is no pagination yet, so
        this is the most recent window rather than the whole history — the
        history itself is complete in the database.
      </p>
    </main>
  );
}

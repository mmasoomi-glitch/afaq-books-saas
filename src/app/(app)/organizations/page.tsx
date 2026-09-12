import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SESSION_COOKIE } from "../../../server/http/cookies";
import { resolveSession } from "../../../server/auth/session";
import { AuthError } from "../../../server/auth/errors";
import { listOrganizations } from "../../../server/auth/membership";
import NewOrganization from "./NewOrganization";

export const metadata: Metadata = {
  title: "Organizations · Afaq Books",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Where a signed-in user lands.
 *
 * This page is NOT organization-scoped — it is the list you choose from, so
 * there is no `orgSlug` and nothing for `requirePageScope` to resolve. It
 * therefore reads the session directly, which is the one place outside
 * `page-scope.ts` that does so.
 *
 * The authorization it performs is structural rather than a check: the query is
 * driven from the user's own memberships, so it cannot return an organization
 * they are not in. There is no filter to forget.
 */
export default async function OrganizationsPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") redirect("/signin");

  let userId: string;
  try {
    ({ userId } = await resolveSession(token));
  } catch (error) {
    // An expired or unknown session is a visitor who needs to sign in, not a
    // 404 — nothing is being named whose existence could leak. Anything else
    // is a bug and goes to the error boundary.
    if (error instanceof AuthError) redirect("/signin");
    throw error;
  }

  const organizations = await listOrganizations(userId);

  return (
    <main>
      <h1>Organizations</h1>

      {organizations.length === 0 ? (
        // Truthful empty state. An account with no membership genuinely reaches
        // no organization's data — that is the tenancy model working — so this
        // says what to do about it rather than showing an example row.
        <p>
          You are not a member of any organization yet. Create one below, or ask
          an administrator of an existing one to add you.
        </p>
      ) : (
        <ul>
          {organizations.map((org) => (
            <li key={org.organizationId}>
              <strong>{org.name}</strong> — {org.role}
              <br />
              <a href={`/${org.slug}/accounts`}>Chart of accounts</a>
              {" · "}
              <a href={`/${org.slug}/reports/trial-balance`}>Trial balance</a>
              {" · "}
              <a href={`/${org.slug}/members`}>Members</a>
            </li>
          ))}
        </ul>
      )}

      <NewOrganization />
    </main>
  );
}

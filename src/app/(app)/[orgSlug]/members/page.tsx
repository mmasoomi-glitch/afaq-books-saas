import type { Metadata } from "next";
import { requirePageScope } from "../../../../server/next/page-scope";
import {
  ROLE_RANK,
  listMembers,
} from "../../../../server/auth/membership";
import { can } from "../../../../server/auth/permissions";
import MemberAdmin from "./MemberAdmin";

export const metadata: Metadata = {
  title: "Members · Afaq Books",
  robots: { index: false, follow: false },
};

/** One organization's member list. Never cached; see the trial balance page. */
export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function MembersPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await requirePageScope(orgSlug);
  const members = await listMembers(scope);

  // What the VIEWER is shown and what the OWNER is shown differ, and the
  // difference is computed from the same permission table the server enforces
  // with — not from a second, hand-written list of who-sees-what that would
  // drift from it.
  //
  // This decides what is RENDERED. It decides nothing about what is allowed:
  // every action behind these controls is re-checked server-side, and a user
  // who forges a request past a hidden button meets exactly the same refusal.
  const grantableRoles = (
    ["VIEWER", "BOOKKEEPER", "APPROVER", "ACCOUNTANT", "ADMIN"] as const
  ).filter((role) => ROLE_RANK[role] < ROLE_RANK[scope.role]);

  return (
    <main>
      <h1>Members</h1>
      <p>
        {scope.organizationSlug} · you are {article(scope.role)}{" "}
        <strong>{scope.role}</strong>
      </p>

      <table>
        <caption>
          Everyone with access to this organization&rsquo;s books.
        </caption>
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Member since</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId}>
              <td>{member.email}</td>
              <td>{member.name ?? "—"}</td>
              <td>{member.role}</td>
              <td>
                <time dateTime={member.since.toISOString()}>
                  {member.since.toISOString().slice(0, 10)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {can(scope.role, "member.invite") ? (
        <MemberAdmin
          orgSlug={scope.organizationSlug}
          grantableRoles={grantableRoles}
          canRemove={can(scope.role, "member.remove")}
          canTransfer={can(scope.role, "ownership.transfer")}
          members={members.map((m) => ({
            userId: m.userId,
            email: m.email,
            role: m.role,
          }))}
          selfUserId={scope.userId}
        />
      ) : (
        <p>
          {/*
            A truthful explanation rather than a hidden section. Someone who
            cannot invite should know that is why they see no form, not wonder
            whether the page failed to load.
          */}
          Your role does not include inviting or removing members. An
          administrator or the owner can do that.
        </p>
      )}
    </main>
  );
}

/** "an ADMIN" / "a VIEWER". Small, and the alternative reads badly. */
function article(role: string): string {
  return /^[AEIOU]/.test(role) ? "an" : "a";
}

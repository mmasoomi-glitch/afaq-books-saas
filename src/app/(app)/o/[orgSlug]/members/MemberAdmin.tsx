"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Member administration controls.
 *
 * Which controls appear is decided by the server from the same permission table
 * it enforces with. That is a CONVENIENCE, not the control: every action behind
 * these widgets is re-checked server-side, and a user who forges a request past
 * a hidden button meets exactly the same refusal.
 */

export interface MemberAdminProps {
  readonly orgSlug: string;
  readonly grantableRoles: readonly string[];
  readonly canRemove: boolean;
  readonly canTransfer: boolean;
  readonly members: readonly {
    userId: string;
    email: string;
    role: string;
  }[];
  readonly selfUserId: string;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

/**
 * The CSRF token, read from the cookie at CALL time.
 *
 * `__Host-csrf` is deliberately not `HttpOnly` precisely so this can read it —
 * that is what makes double-submit work. The value came from a cookie only our
 * origin could set and read; a cross-origin page can make the browser SEND it
 * but cannot obtain it, so it cannot put a matching value in the header.
 *
 * Read on every call rather than once at render, because the middleware may
 * have refreshed the cookie since this component mounted.
 */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

export default function MemberAdmin({
  orgSlug,
  grantableRoles,
  canRemove,
  canTransfer,
  members,
  selfUserId,
}: MemberAdminProps) {
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(grantableRoles[0] ?? "");
  const [successor, setSuccessor] = useState("");

  async function send(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<void> {
    setPending(true);
    setNotice(undefined);

    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (response.ok) {
        // A full reload, and it is a blunt instrument. The list above is
        // rendered by a server component, so there is no client-side store to
        // update — `useRouter().refresh()` is the better tool and is the change
        // to make when this grows a second interactive surface.
        window.location.reload();
        return;
      }

      if (response.status === 403) {
        // Covers BOTH a CSRF failure and a genuine authorization refusal. The
        // UI does not distinguish them because the server does not tell it
        // which, and it should not: the hidden-button state is a convenience,
        // and the server's refusal is the actual control.
        setNotice({ kind: "error", text: "You are not allowed to do that." });
        return;
      }

      if (response.status === 404) {
        // May also mean the caller is no longer a member of this organization.
        // The API collapses those cases deliberately, so this message has to
        // cover both without guessing.
        setNotice({
          kind: "error",
          text: "That member or organization could not be found.",
        });
        return;
      }

      if (response.status === 409) {
        setNotice({ kind: "error", text: "That person is already a member." });
        return;
      }

      if (response.status === 400) {
        setNotice({ kind: "error", text: "Check the details and try again." });
        return;
      }

      setNotice({ kind: "error", text: "Something went wrong." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      // Always. A path that returned before re-enabling would leave every
      // control disabled with the page looking frozen and no explanation.
      setPending(false);
    }
  }

  async function handleInvite(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await send(`/api/o/${orgSlug}/members`, "POST", {
      email: inviteEmail,
      role: inviteRole,
    });
  }

  async function handleTransfer(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (successor === "") return;
    await send(`/api/o/${orgSlug}/ownership`, "POST", { userId: successor });
  }

  // Members this caller may act on: not themselves, and holding a role they
  // are permitted to grant.
  //
  // Those they cannot act on are simply absent rather than shown disabled. A
  // disabled control for an action you could never take is noise, and the
  // member table above already lists everyone — nothing is being hidden, only
  // the controls that would never work.
  const actionable = members.filter(
    (member) =>
      member.userId !== selfUserId && grantableRoles.includes(member.role),
  );
  const candidates = members.filter((member) => member.userId !== selfUserId);

  return (
    <div>
      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <section>
        <h2>Invite a member</h2>
        {grantableRoles.length === 0 ? (
          <p>There are no roles you can grant.</p>
        ) : (
          <form onSubmit={handleInvite}>
            <div>
              <label htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                required
                disabled={pending}
                value={inviteEmail}
                onChange={(event) => {
                  setInviteEmail(event.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                required
                disabled={pending}
                value={inviteRole}
                onChange={(event) => {
                  setInviteRole(event.target.value);
                }}
              >
                {grantableRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={pending}>
              {pending ? "Working…" : "Invite"}
            </button>
          </form>
        )}
        <p>
          The person must already have an account. There is no email invitation
          yet, so ask them to register first.
        </p>
      </section>

      {actionable.length === 0 ? null : (
        <section>
          <h2>Change a role</h2>
          <ul>
            {actionable.map((member) => (
              <li key={member.userId}>
                <label htmlFor={`role-${member.userId}`}>{member.email}</label>
                <select
                  id={`role-${member.userId}`}
                  defaultValue={member.role}
                  disabled={pending}
                  onChange={(event) => {
                    void send(
                      `/api/o/${orgSlug}/members/${member.userId}`,
                      "PATCH",
                      { role: event.target.value },
                    );
                  }}
                >
                  {grantableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                {canRemove ? (
                  // No `window.confirm`. A browser dialog blocks the page and
                  // is untestable; a two-step confirmation belongs here, and
                  // until it exists this button removes immediately and says so.
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      void send(
                        `/api/o/${orgSlug}/members/${member.userId}`,
                        "DELETE",
                      );
                    }}
                  >
                    Remove immediately
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canTransfer && candidates.length > 0 ? (
        <section>
          <h2>Transfer ownership</h2>
          <p>
            This makes the chosen person the owner and demotes you to ADMIN. You
            will not be able to undo it yourself afterwards — only the new owner
            can transfer it back.
          </p>
          <form onSubmit={handleTransfer}>
            <label htmlFor="successor">New owner</label>
            <select
              id="successor"
              required
              disabled={pending}
              value={successor}
              onChange={(event) => {
                setSuccessor(event.target.value);
              }}
            >
              <option value="">Choose a member</option>
              {candidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email} ({member.role})
                </option>
              ))}
            </select>
            <button type="submit" disabled={pending || successor === ""}>
              Transfer ownership
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

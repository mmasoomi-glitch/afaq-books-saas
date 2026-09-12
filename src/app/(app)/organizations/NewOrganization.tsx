"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Create an organization, becoming its OWNER.
 *
 * Nothing here is a control. The slug rules below are `CHECK` constraints in
 * the database and the server answers 400 on a violation regardless of what
 * this form allows; the pattern and the hint exist so a person is told before
 * they submit rather than after.
 */

/** See the note in `csrfToken` in MemberAdmin — read at call time, not render. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

export default function NewOrganization() {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({ slug: slug.trim().toLowerCase(), name }),
      });

      if (response.status === 201) {
        window.location.reload();
        return;
      }

      if (response.status === 409) {
        setNotice({
          kind: "error",
          text: "That address is already taken. Choose another.",
        });
        return;
      }

      if (response.status === 400) {
        // The server does not say WHICH rule failed, and this message covers
        // all of them rather than guessing. The rules are also stated under the
        // field, so a person has them before they submit.
        setNotice({
          kind: "error",
          text:
            "The address must be 3–40 characters of lowercase letters, digits " +
            "and single hyphens, and must not be a reserved word.",
        });
        return;
      }

      if (response.status === 401) {
        setNotice({ kind: "error", text: "Your session has ended. Sign in again." });
        return;
      }

      if (response.status === 403) {
        setNotice({
          kind: "error",
          text: "Request rejected. Reload the page and try again.",
        });
        return;
      }

      setNotice({ kind: "error", text: "Something went wrong." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Create an organization</h2>

      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="org-name">Name</label>
          <input
            id="org-name"
            type="text"
            required
            disabled={pending}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>

        <div>
          <label htmlFor="org-slug">Address</label>
          <input
            id="org-slug"
            type="text"
            required
            minLength={3}
            maxLength={40}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            disabled={pending}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
          />
          <p>
            This appears in every link to your books: <code>/your-address/…</code>.
            Lowercase letters, digits and single hyphens, 3 to 40 characters. It
            cannot be changed here afterwards.
          </p>
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create organization"}
        </button>
      </form>
    </section>
  );
}

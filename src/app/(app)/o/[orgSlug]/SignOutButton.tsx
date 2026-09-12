"use client";

import { useState } from "react";

/**
 * Sign out — a button that fetches, not a form that posts.
 *
 * The obvious version is `<form action="/api/auth/signout" method="post">`, and
 * it would never have worked. That endpoint enforces double-submit CSRF by
 * comparing an `x-csrf-token` request header against the `__Host-csrf` cookie,
 * and an HTML form cannot set a request header. The button would have rendered,
 * looked entirely functional, and answered 403 every time.
 */

/** See MemberAdmin — read at call time, because sign-in rotates this cookie. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function signOut(): Promise<void> {
    setError(undefined);
    setPending(true);

    try {
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
      });

      if (response.ok) {
        // A full navigation, deliberately, rather than a router push.
        //
        // Every server component above this was rendered for the user who is
        // signing out, and a client-side transition can serve those from the
        // router cache — leaving the previous user's organization name and role
        // on screen after they signed out. Discarding the document discards
        // that cache with it.
        window.location.assign("/signin");
        return;
      }

      // "still active", not "something went wrong", because of the two lies
      // available here that is the safe one. Telling someone they are signed
      // out when they are not is how a session is left open on a shared
      // machine by a person who believed they had closed it.
      setError("Could not sign out. Your session is still active.");
    } catch {
      setError("Could not reach the server. Your session is still active.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void signOut();
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

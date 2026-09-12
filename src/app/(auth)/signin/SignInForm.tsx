"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * This component holds NO security logic.
 *
 * Every check that matters — rate limiting, the constant-time password
 * comparison, the CSRF verification, the organization scope — happens on the
 * server. The token echoed here is supplied by the page, not minted in the
 * browser, because a token the client invents proves nothing: the whole point
 * of double-submit is that the value came from a cookie only our origin could
 * read.
 *
 * The messages below are chosen as carefully as the server's status codes. See
 * the 401 branch in particular.
 */

export interface SignInFormProps {
  readonly csrfToken: string;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

/** Seconds from a `Retry-After` header, when it is present and sane. */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export default function SignInForm({ csrfToken }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 200) {
        // Cleared on success because a shared machine keeps the DOM around, and
        // a password left in a mounted input survives until the tab closes.
        setEmail("");
        setPassword("");
        // There is a destination now. `/organizations` is the list you choose
        // from: it needs no org slug, and for a brand-new account it says
        // plainly that there is nothing to see yet and what to do about it.
        //
        // `assign` rather than `replace`, so Back returns to the sign-in page
        // rather than skipping past it — a user who signed into the wrong
        // account should be able to go back.
        window.location.assign("/organizations");
        return;
      }

      if (response.status === 401) {
        // ONE message for an unknown address and for a wrong password. The
        // server already refuses to distinguish them; wording them differently
        // here would hand back the account-enumeration oracle the API gave up.
        setNotice({ kind: "error", text: "Invalid email or password." });
        return;
      }

      if (response.status === 429) {
        const seconds = retryAfterSeconds(response);
        setNotice({
          kind: "error",
          text:
            seconds === undefined
              ? "Too many attempts. Try again shortly."
              : `Too many attempts. Try again in ${String(seconds)} seconds.`,
        });
        return;
      }

      if (response.status === 403) {
        // The CSRF failure. The honest remedy is a fresh token, and the only
        // way to get one is a new page load — so that is what we say, rather
        // than inviting the user to retry something that will fail identically.
        setNotice({
          kind: "error",
          text: "Request rejected. Reload the page and try again.",
        });
        return;
      }

      if (response.status === 400) {
        setNotice({
          kind: "error",
          text: "Enter an email address and a password.",
        });
        return;
      }

      // The server's own message is deliberately NOT surfaced. An error body
      // can carry a constraint name, a column, or a query fragment.
      setNotice({ kind: "error", text: "Something went wrong." });
    } catch {
      // A network failure rejects the fetch. Letting that escape would leave
      // the button disabled for ever with no explanation.
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}
    </form>
  );
}

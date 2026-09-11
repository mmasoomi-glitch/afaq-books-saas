"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * This component holds no security logic.
 *
 * Every bound it appears to enforce is enforced again on the server — the
 * password length in `hashPassword`, the email shape and uniqueness in
 * `registerUser`, the rate limit before either. The CSRF token is supplied by
 * the page rather than minted here, because a token the client invents proves
 * nothing: the whole point of double-submit is that the value came from a
 * cookie only our origin could read.
 */

export interface RegisterFormProps {
  readonly csrfToken: string;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

const MIN_PASSWORD_LENGTH = 12;

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export default function RegisterForm({ csrfToken }: RegisterFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);

    // A COURTESY, not a control. `hashPassword` enforces the same bound and
    // would reject this anyway — nothing here is load-bearing.
    //
    // It is worth doing because registration is limited to three attempts per
    // hour, and that limit is consumed BEFORE the password is validated. A typo
    // that reached the server would cost the user a third of their hourly
    // budget to learn something we already knew.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setNotice({
        kind: "error",
        text: `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
      });
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          email,
          password,
          ...(name.trim() === "" ? {} : { name: name.trim() }),
        }),
      });

      if (response.status === 201) {
        setEmail("");
        setName("");
        setPassword("");
        // Said explicitly, because the alternative is a user who registers,
        // signs in, sees nothing at all, and reasonably concludes the product
        // is broken. The empty state IS the tenancy model working: an account
        // with no membership can reach no organization's data, by design.
        setNotice({
          kind: "success",
          text:
            "Account created. An administrator must add you to an organization " +
            "before you can sign in to it.",
        });
        return;
      }

      if (response.status === 409) {
        // This DOES reveal whether an address is already registered, and that
        // is unavoidable: a user whose sign-up silently fails cannot proceed.
        // The asymmetry with sign-in — which refuses to distinguish an unknown
        // address from a wrong password — is deliberate and is why sign-up is
        // limited harder (3/hour against 5/15min). Email confirmation is the
        // real fix and does not exist yet.
        setNotice({ kind: "error", text: "That email is already registered." });
        return;
      }

      if (response.status === 429) {
        const seconds = retryAfterSeconds(response);
        setNotice({
          kind: "error",
          text:
            seconds === undefined
              ? "Too many attempts. Try again later."
              : `Too many attempts. Try again in ${String(seconds)} seconds.`,
        });
        return;
      }

      if (response.status === 403) {
        // The CSRF failure. A fresh token needs a new page load, so that is
        // what we ask for rather than inviting a retry that fails identically.
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

      // The server's own message is deliberately not surfaced: an error body
      // can carry a constraint name, a column, or a query fragment.
      setNotice({ kind: "error", text: "Something went wrong." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      // Always. A path that returned before re-enabling would leave the button
      // disabled for ever, with the page looking frozen and no explanation.
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <div>
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div>
        <label htmlFor="register-name">Name (optional)</label>
        <input
          id="register-name"
          type="text"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div>
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

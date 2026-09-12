"use client";

import { useState } from "react";

/**
 * Reverse a posted entry.
 *
 * Two steps, not one, and not a `window.confirm`. A browser dialog blocks the
 * page and cannot be tested; an inline confirmation is both testable and
 * clearer about what is actually going to happen, which for a ledger write is
 * worth more than brevity.
 *
 * The second step spells out the consequence in full: this does not undo
 * anything. It posts a second, opposite entry, and both remain in the journal
 * for ever. Someone who expects a delete and gets two entries will otherwise
 * conclude the product is broken.
 */

export interface ReverseButtonProps {
  readonly orgSlug: string;
  readonly entryId: string;
  readonly journalNumber: number | null;
}

/** See MemberAdmin — read at call time, because sign-in rotates this cookie. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

/** The server's own explanation of a 422, or a safe fallback. */
function refusalMessage(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const wrapper: unknown = body.error;
    if (typeof wrapper === "object" && wrapper !== null && "message" in wrapper) {
      const message: unknown = wrapper.message;
      if (typeof message === "string" && message !== "") return message;
    }
  }
  return "it was refused";
}

export default function ReverseButton({
  orgSlug,
  entryId,
  journalNumber,
}: ReverseButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function reverse(): Promise<void> {
    setError(undefined);
    setPending(true);

    try {
      const response = await fetch(
        `/api/${orgSlug}/entries/${entryId}/reverse`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken(),
          },
          body: JSON.stringify({}),
        },
      );

      if (response.status === 201) {
        window.location.reload();
        return;
      }

      if (response.status === 422) {
        // The server names what happened — "that entry has already been
        // reversed", "that accounting period is closed or locked". Safe to
        // surface, because 422 is reserved for facts about the request.
        const body: unknown = await response.json();
        setError(`This entry was not reversed: ${refusalMessage(body)}.`);
        return;
      }

      if (response.status === 403) {
        setError("Your role cannot reverse entries.");
        return;
      }

      if (response.status === 404) {
        setError("That entry could not be found.");
        return;
      }

      setError("Something went wrong.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <div>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Reverse entry {journalNumber === null ? "" : `#${String(journalNumber)}`}
        </button>
      </div>
    );
  }

  return (
    <div>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <p role="status">
        This does not delete or undo the entry. It posts a second, opposite
        entry dated today, and both stay in the journal permanently. The
        original remains exactly as it was.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void reverse();
        }}
      >
        {pending ? "Reversing…" : "Yes, post the reversal"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setConfirming(false);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

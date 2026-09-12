"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Add an account to the chart.
 *
 * Nothing here is a control. `guardedCreateAccount` asserts
 * `ledger.account.create` before it writes, the `(organization_id, code)`
 * unique constraint is what actually prevents duplicates, and `currency` is a
 * `CHAR(3)` column. The validation below exists so a person is told before they
 * submit rather than after.
 */

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

/** See MemberAdmin — read at call time, because sign-in rotates this cookie. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

export interface NewAccountProps {
  readonly orgSlug: string;
}

export default function NewAccount({ orgSlug }: NewAccountProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("ASSET");
  const [currency, setCurrency] = useState("USD");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch(`/api/o/${orgSlug}/accounts`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({ code, name, type, currency }),
      });

      if (response.status === 201) {
        window.location.reload();
        return;
      }

      if (response.status === 409) {
        setNotice({
          kind: "error",
          text: `Code ${code} is already used by another account.`,
        });
        return;
      }

      if (response.status === 403) {
        setNotice({ kind: "error", text: "You are not allowed to do that." });
        return;
      }

      if (response.status === 404) {
        setNotice({
          kind: "error",
          text: "This organization could not be found. Reload and sign in again.",
        });
        return;
      }

      if (response.status === 400) {
        setNotice({
          kind: "error",
          text: "Check the code, name, type and currency and try again.",
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
      <h2>Add an account</h2>

      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="account-code">Code</label>
          <input
            id="account-code"
            type="text"
            required
            disabled={pending}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
          <p>
            Unique within this organization. Most charts use numeric ranges —
            1000s for assets, 4000s for income — but nothing here enforces a
            convention, because the right one depends on your jurisdiction and
            your accountant.
          </p>
        </div>

        <div>
          <label htmlFor="account-name">Name</label>
          <input
            id="account-name"
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
          <label htmlFor="account-type">Type</label>
          <select
            id="account-type"
            required
            disabled={pending}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <p>
            {/*
              Said here because it is the one field a non-accountant gets wrong
              and cannot correct afterwards without a reversal: the type decides
              which side of the trial balance the account sits on and how the
              balance sheet and P&L pick it up.
            */}
            This decides how the account behaves in every report, and it cannot
            be changed once entries have been posted to it.
          </p>
        </div>

        <div>
          <label htmlFor="account-currency">Currency</label>
          <input
            id="account-currency"
            type="text"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            disabled={pending}
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value.toUpperCase());
            }}
          />
          <p>
            A three-letter code such as USD or SAR. It is not checked against a
            list of real currencies — that list changes, and refusing a
            legitimate one because our table is out of date would be worse than
            accepting a typo you can see.
          </p>
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add account"}
        </button>
      </form>
    </section>
  );
}

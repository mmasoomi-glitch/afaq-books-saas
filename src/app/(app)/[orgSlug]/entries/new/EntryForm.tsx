"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * The form that writes to the ledger.
 *
 * The running total below is a CONVENIENCE and nothing more. What decides
 * whether an entry is accepted is `je_balanced_check`, a DEFERRABLE constraint
 * trigger evaluated at COMMIT — the only point at which the question has a
 * trustworthy answer. This component computes a sum so a person is not asked to
 * do arithmetic in their head; it does not gate submission on that sum, and it
 * says so on screen.
 *
 * Amounts are STRINGS the whole way down. `accounting-integrity.md` I8 forbids a
 * JavaScript float anywhere near a stored amount, and `0.1 + 0.2` is exactly the
 * arithmetic a ledger cannot survive. The total below is computed in integer
 * ten-thousandths for the same reason.
 */

export interface EntryFormProps {
  readonly orgSlug: string;
  readonly accounts: readonly {
    id: string;
    code: string;
    name: string;
    currency: string;
  }[];
  readonly periods: readonly { id: string; name: string }[];
}

interface Line {
  readonly key: string;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;

/** See MemberAdmin — read at call time, because sign-in rotates this cookie. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

/**
 * An amount as an integer number of ten-thousandths.
 *
 * Never `parseFloat`. The column has scale 4, so a value is exactly
 * representable as an integer at that scale, and integer arithmetic is the only
 * kind that gives the same answer twice.
 */
function toTenThousandths(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  if (!AMOUNT.test(trimmed)) return undefined;

  const [whole = "0", fraction = ""] = trimmed.split(".");
  const padded = (fraction + "0000").slice(0, 4);
  return Number(whole) * 10_000 + Number(padded);
}

/** Ten-thousandths back to a displayable string. */
function fromTenThousandths(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 10_000);
  const fraction = String(abs % 10_000).padStart(4, "0");
  return `${sign}${String(whole)}.${fraction}`;
}

/** The server's own explanation of a 422, or a safe fallback. */
function refusalMessage(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const wrapper: unknown = body.error;
    if (typeof wrapper === "object" && wrapper !== null && "message" in wrapper) {
      const message: unknown = wrapper.message;
      if (typeof message === "string" && message !== "") {
        return `The entry was refused: ${message}.`;
      }
    }
  }
  return "The entry was refused.";
}

function blankLine(): Line {
  return {
    key: crypto.randomUUID(),
    accountId: "",
    debit: "",
    credit: "",
    memo: "",
  };
}

export default function EntryForm({
  orgSlug,
  accounts,
  periods,
}: EntryFormProps) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? "USD");
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  function updateLine(key: string, patch: Partial<Omit<Line, "key">>): void {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  let debitTotal = 0;
  let creditTotal = 0;
  let unparseable = false;
  for (const line of lines) {
    const debit = toTenThousandths(line.debit);
    const credit = toTenThousandths(line.credit);
    if (debit === undefined || credit === undefined) {
      unparseable = true;
      continue;
    }
    debitTotal += debit;
    creditTotal += credit;
  }
  const difference = debitTotal - creditTotal;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch(`/api/${orgSlug}/entries`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({
          periodId,
          entryDate,
          description,
          currency,
          lines: lines
            .filter((line) => line.accountId !== "")
            .map((line) => ({
              accountId: line.accountId,
              ...(line.debit.trim() === "" ? {} : { debit: line.debit.trim() }),
              ...(line.credit.trim() === ""
                ? {}
                : { credit: line.credit.trim() }),
              ...(line.memo.trim() === "" ? {} : { memo: line.memo.trim() }),
            })),
        }),
      });

      if (response.status === 201) {
        const body: unknown = await response.json();
        const journalNumber =
          typeof body === "object" && body !== null && "journalNumber" in body
            ? String(body.journalNumber)
            : "?";
        setNotice({
          kind: "success",
          text: `Posted as journal entry ${journalNumber}. It is now immutable — correct it with a reversal from the journal, not an edit.`,
        });
        setLines([blankLine(), blankLine()]);
        setDescription("");
        return;
      }

      if (response.status === 400) {
        setNotice({
          kind: "error",
          text: "Check the date, description, currency and lines and try again.",
        });
        return;
      }

      if (response.status === 403) {
        setNotice({ kind: "error", text: "You are not allowed to post here." });
        return;
      }

      if (response.status === 404) {
        setNotice({
          kind: "error",
          text: "This organization could not be found. Reload and sign in again.",
        });
        return;
      }

      if (response.status === 422) {
        // The server names what the user did — "debits do not equal credits",
        // "that accounting period is closed or locked" — so this shows its
        // message rather than guessing. It is safe to surface precisely because
        // 422 is reserved for refusals that are facts about the submission; a
        // 500 body is not shown, and never should be.
        const body: unknown = await response.json();
        setNotice({ kind: "error", text: refusalMessage(body) });
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
    <form onSubmit={handleSubmit}>
      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <div>
        <label htmlFor="entry-period">Period</label>
        <select
          id="entry-period"
          required
          disabled={pending}
          value={periodId}
          onChange={(event) => {
            setPeriodId(event.target.value);
          }}
        >
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {period.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="entry-date">Date</label>
        <input
          id="entry-date"
          type="date"
          required
          disabled={pending}
          value={entryDate}
          onChange={(event) => {
            setEntryDate(event.target.value);
          }}
        />
      </div>

      <div>
        <label htmlFor="entry-description">Description</label>
        <input
          id="entry-description"
          type="text"
          required
          disabled={pending}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div>
        <label htmlFor="entry-currency">Currency</label>
        <input
          id="entry-currency"
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
      </div>

      <table>
        <caption>Lines. Each one is a debit or a credit, never both.</caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
            <th scope="col">Memo</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.key}>
              <td>
                <label htmlFor={`line-account-${String(index)}`}>
                  Account, line {index + 1}
                </label>
                <select
                  id={`line-account-${String(index)}`}
                  disabled={pending}
                  value={line.accountId}
                  onChange={(event) => {
                    updateLine(line.key, { accountId: event.target.value });
                  }}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label htmlFor={`line-debit-${String(index)}`}>
                  Debit, line {index + 1}
                </label>
                <input
                  id={`line-debit-${String(index)}`}
                  type="text"
                  inputMode="decimal"
                  disabled={pending || line.credit.trim() !== ""}
                  value={line.debit}
                  onChange={(event) => {
                    updateLine(line.key, { debit: event.target.value });
                  }}
                />
              </td>
              <td>
                <label htmlFor={`line-credit-${String(index)}`}>
                  Credit, line {index + 1}
                </label>
                <input
                  id={`line-credit-${String(index)}`}
                  type="text"
                  inputMode="decimal"
                  disabled={pending || line.debit.trim() !== ""}
                  value={line.credit}
                  onChange={(event) => {
                    updateLine(line.key, { credit: event.target.value });
                  }}
                />
              </td>
              <td>
                <label htmlFor={`line-memo-${String(index)}`}>
                  Memo, line {index + 1}
                </label>
                <input
                  id={`line-memo-${String(index)}`}
                  type="text"
                  disabled={pending}
                  value={line.memo}
                  onChange={(event) => {
                    updateLine(line.key, { memo: event.target.value });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{fromTenThousandths(debitTotal)}</td>
            <td>{fromTenThousandths(creditTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setLines((current) => [...current, blankLine()]);
        }}
      >
        Add a line
      </button>

      <p role="status">
        {unparseable
          ? "One or more amounts is not a number with at most four decimal places."
          : difference === 0
            ? "Debits equal credits."
            : `Out by ${fromTenThousandths(Math.abs(difference))}.`}
      </p>

      <p>
        {/*
          Stated because a running total that agreed with the form and
          disagreed with the database would be the worse kind of wrong. The
          button is NOT disabled when the total is out: the server is the
          authority, and a UI that refuses to submit is a UI that can be wrong
          in a direction nobody can override.
        */}
        This total is a convenience. The ledger itself refuses an unbalanced
        entry at commit time, and that check — not this one — is what decides.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post entry"}
      </button>

      <p>
        Posting is final. A posted entry cannot be edited or deleted; correcting
        it means posting a reversal, which leaves both in the record.
      </p>
    </form>
  );
}

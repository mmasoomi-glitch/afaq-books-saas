"use client";

import { useState } from "react";
import type { FormEvent } from "react";

/**
 * Create a period, and move one between open, closed and locked.
 *
 * The reason field is REQUIRED on every transition, and that is not politeness.
 * `accounting-integrity.md` I3 requires an unlock to be recorded in the audit
 * trail, and the services write that row — but a row saying "unlocked by
 * admin@example.com" answers nothing an auditor asks. "Unlocked to correct the
 * misposted March payroll accrual" does.
 *
 * The server refuses a transition with no reason. This form does not let one be
 * attempted, which is a courtesy on top, not the control.
 */

export interface PeriodAdminProps {
  readonly orgSlug: string;
  readonly periods: readonly { id: string; name: string; status: string }[];
  readonly canClose: boolean;
  readonly canLock: boolean;
  readonly canUnlock: boolean;
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

/** See MemberAdmin — read at call time, because sign-in rotates this cookie. */
function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

function refusalMessage(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const wrapper: unknown = body.error;
    if (
      typeof wrapper === "object" &&
      wrapper !== null &&
      "message" in wrapper
    ) {
      const message: unknown = wrapper.message;
      if (typeof message === "string" && message !== "") return message;
    }
  }
  return "it was refused";
}

/** The transitions a period in `status` can legitimately make. */
function available(
  status: string,
  canClose: boolean,
  canLock: boolean,
  canUnlock: boolean,
): readonly { action: string; label: string }[] {
  // Derived from the status, not from a flat list of every verb. A "close"
  // button on an already-closed period is a control whose only outcome is an
  // error, and offering it teaches people to ignore refusals.
  if (status === "OPEN") {
    return [
      ...(canClose ? [{ action: "close", label: "Close" }] : []),
      ...(canLock ? [{ action: "lock", label: "Lock" }] : []),
    ];
  }
  if (status === "CLOSED") {
    return [
      ...(canLock ? [{ action: "lock", label: "Lock" }] : []),
      ...(canUnlock ? [{ action: "unlock", label: "Reopen" }] : []),
    ];
  }
  if (status === "LOCKED") {
    return canUnlock ? [{ action: "unlock", label: "Unlock" }] : [];
  }
  return [];
}

export default function PeriodAdmin({
  orgSlug,
  periods,
  canClose,
  canLock,
  canUnlock,
}: PeriodAdminProps) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function send(path: string, body: unknown): Promise<void> {
    setNotice(undefined);
    setPending(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify(body),
      });

      if (response.status === 200 || response.status === 201) {
        window.location.reload();
        return;
      }

      if (response.status === 422) {
        const parsed: unknown = await response.json();
        setNotice({
          kind: "error",
          text: `Refused: ${refusalMessage(parsed)}.`,
        });
        return;
      }

      if (response.status === 403) {
        setNotice({ kind: "error", text: "Your role cannot do that." });
        return;
      }

      if (response.status === 400) {
        setNotice({
          kind: "error",
          text: "Check the dates and the reason, then try again.",
        });
        return;
      }

      if (response.status === 404) {
        setNotice({
          kind: "error",
          text: "That period or organization could not be found.",
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

  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await send(`/api/o/${orgSlug}/periods`, { name, startDate, endDate });
  }

  return (
    <div>
      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <section>
        <h2>Open a period</h2>
        <form onSubmit={handleCreate}>
          <div>
            <label htmlFor="period-name">Name</label>
            <input
              id="period-name"
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
            <label htmlFor="period-start">From</label>
            <input
              id="period-start"
              type="date"
              required
              disabled={pending}
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
            />
          </div>
          <div>
            <label htmlFor="period-end">To</label>
            <input
              id="period-end"
              type="date"
              required
              disabled={pending}
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
              }}
            />
          </div>
          <button type="submit" disabled={pending}>
            {pending ? "Working…" : "Open period"}
          </button>
        </form>
        <p>
          Periods cannot overlap — the database refuses it — so each one covers
          a distinct stretch of time.
        </p>
      </section>

      {periods.length === 0 ? null : (
        <section>
          <h2>Change a period</h2>
          <p>
            Every change records the reason you give, permanently, against the
            person who made it.
          </p>
          <ul>
            {periods.map((period) => {
              const actions = available(
                period.status,
                canClose,
                canLock,
                canUnlock,
              );
              if (actions.length === 0) return null;
              const reason = reasons[period.id] ?? "";

              return (
                <li key={period.id}>
                  <label htmlFor={`reason-${period.id}`}>
                    {period.name} ({period.status}) — reason
                  </label>
                  <input
                    id={`reason-${period.id}`}
                    type="text"
                    disabled={pending}
                    value={reason}
                    onChange={(event) => {
                      const value = event.target.value;
                      setReasons((current) => ({
                        ...current,
                        [period.id]: value,
                      }));
                    }}
                  />
                  {actions.map((action) => (
                    <button
                      key={action.action}
                      type="button"
                      // Disabled until a reason exists. The server refuses
                      // without one regardless; this stops the user discovering
                      // that after deciding to act.
                      disabled={pending || reason.trim() === ""}
                      onClick={() => {
                        void send(
                          `/api/o/${orgSlug}/periods/${period.id}/transition`,
                          { action: action.action, reason: reason.trim() },
                        );
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

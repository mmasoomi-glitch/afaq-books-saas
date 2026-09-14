"use client";

import { useState } from "react";
import type { FormEvent } from "react";

function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ?? "";
}

interface Notice {
  readonly kind: "error" | "success";
  readonly text: string;
}

export default function NewInvoice({ orgSlug }: { readonly orgSlug: string }) {
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch(`/api/o/${orgSlug}/sales/invoices`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({ customerId, issueDate, dueDate, memo: memo || null }),
      });

      if (response.status === 201) {
        window.location.reload();
        return;
      }

      if (response.status === 403) {
        setNotice({ kind: "error", text: "You are not allowed to do that." });
        return;
      }

      if (response.status === 404) {
        setNotice({ kind: "error", text: "Organization not found." });
        return;
      }

      setNotice({ kind: "error", text: "Could not create invoice." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>New invoice</h2>

      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="invoice-customer">Customer ID</label>
          <input
            id="invoice-customer"
            type="text"
            required
            disabled={pending}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
          <p>The customer ID from the customers list.</p>
        </div>

        <div>
          <label htmlFor="invoice-date">Issue date</label>
          <input
            id="invoice-date"
            type="date"
            required
            disabled={pending}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="invoice-due">Due date</label>
          <input
            id="invoice-due"
            type="date"
            required
            disabled={pending}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="invoice-memo">Memo</label>
          <input
            id="invoice-memo"
            type="text"
            disabled={pending}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invoice"}
        </button>
      </form>
    </section>
  );
}

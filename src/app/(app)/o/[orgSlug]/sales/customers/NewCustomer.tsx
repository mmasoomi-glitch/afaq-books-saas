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

export default function NewCustomer({ orgSlug }: { readonly orgSlug: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setNotice(undefined);
    setPending(true);

    try {
      const response = await fetch(`/api/o/${orgSlug}/sales/customers`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken(),
        },
        body: JSON.stringify({ name, email: email || null, phone: phone || null, currency }),
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

      setNotice({ kind: "error", text: "Could not create customer." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Add a customer</h2>

      {notice === undefined ? null : (
        <p role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="customer-name">Name</label>
          <input
            id="customer-name"
            type="text"
            required
            disabled={pending}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="customer-email">Email</label>
          <input
            id="customer-email"
            type="email"
            disabled={pending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="customer-phone">Phone</label>
          <input
            id="customer-phone"
            type="tel"
            disabled={pending}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="customer-currency">Currency</label>
          <input
            id="customer-currency"
            type="text"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            disabled={pending}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add customer"}
        </button>
      </form>
    </section>
  );
}

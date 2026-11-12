"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePending } from "../../usePending";
import { focusField, invalidForm, notify } from "../../Toast";

export default function AdminLoginPage() {
  const router = useRouter();
  const [busy, run] = usePending();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message);
        notify(data.message, "error");
        focusField(form, "password");
        return;
      }
      notify("Signed in");
      router.replace("/admin");
    } catch {
      setError("Login is unavailable. Please try again.");
      notify("Login is unavailable. Please try again.", "error");
    }
  }
  return (
    <section className="admin-login">
      <div className="admin-login-intro">
        <Link href="/" className="admin-brand"><span>DANUBE <em>MILANO</em></span><small>STORE ADMIN</small></Link>
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>Welcome back.</h1>
        <p>Sign in to manage the catalogue, orders, and inventory.</p>
        <Link href="/" className="back-link">← Return to storefront</Link>
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); run(() => submit(event)); }}
        onInvalid={invalidForm}
        className="form-panel admin-login-form"
      >
        <h2>Sign in</h2>
        <p>Use your administrator credentials.</p>
        <label>
          Email
          <input
            name="email"
            autoComplete="username"
            type="email"
            required
            maxLength="254"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            autoComplete="current-password"
            type="password"
            required
            maxLength="1024"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="button" disabled={busy}>Open workspace</button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

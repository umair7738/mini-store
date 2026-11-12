"use client";

import { apiFetch } from "../../../../lib/apiFetch";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function VerifyAccountPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (window.location.hash) { setToken(window.location.hash.slice(1)); window.history.replaceState(null, "", window.location.pathname); } }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await apiFetch("/api/customer/verification/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Verification failed.");
      setDone(true); setMessage(data.message);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <section className="section narrow"><div className="account-card"><h1>Verify your email</h1>{message && <p className={done ? "notice" : "notice error"} role="status">{message}</p>}{done ? <Link href="/account">View account</Link> : <form onSubmit={submit}><p>Set a password to finish verifying your account.</p><label>Password<input type="password" autoComplete="new-password" required minLength="10" maxLength="1024" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button" disabled={!token || busy}>{busy ? "Verifying…" : "Verify email"}</button></form>}</div></section>;
}

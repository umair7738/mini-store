"use client";

import { apiFetch } from "../../../lib/apiFetch";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerAuthForm({ register = false, next = "/account" }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/customer/${register ? "register" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not complete account request");
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/account");
      router.refresh();
    } catch (problem) { setError(problem.message); setBusy(false); }
  }
  return <section className="section narrow account-auth"><p className="eyebrow">DANUBE MILANO ACCOUNT</p><form className="account-card" onSubmit={submit}><h1>{register ? "Create account" : "Sign in"}</h1><p>Guest checkout is always available. Your account keeps your details and order history together.</p>{error && <p className="notice error" role="alert">{error}</p>}
    {register && <label>Full name<input required maxLength="120" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
    <label>Email<input type="email" required maxLength="254" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
    {register && <label>Phone (optional)<input type="tel" maxLength="30" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>}
    <label>Password<input type="password" required minLength={register ? 10 : undefined} maxLength="1024" autoComplete={register ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
    <button className="button" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
    <p>{register ? <>Already have an account? <Link href={`/account/login?next=${encodeURIComponent(next)}`}>Sign in</Link></> : <>New here? <Link href={`/account/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}</p>
  </form></section>;
}

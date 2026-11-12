"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function VerifyOrderAccess() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(window.location.hash.slice(1)); }, []);
  async function verify() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/orders/recover/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "This verification link is invalid or expired.");
      router.replace(`/orders/${data.orderNumber}`);
    } catch (problem) { setError(problem.message); setBusy(false); }
  }
  return <section className="section narrow"><p className="eyebrow">ORDER RECOVERY</p><div className="account-card"><h1>Verify order access</h1><p>Confirm this secure email link to add the order to your current device.</p>{error && <p className="notice error" role="alert">{error}</p>}<button className="button" disabled={!token || busy} onClick={verify}>{busy ? "Verifying…" : "View my order"}</button> <Link href="/orders">Back to My Orders</Link></div></section>;
}

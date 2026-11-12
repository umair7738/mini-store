"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "../../../lib/money";

export default function MyOrdersPage() {
  const [orders, setOrders] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState({ orderNumber: "", email: "" });
  async function load() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    if (!response.ok) throw new Error("Orders could not be loaded.");
    setOrders((await response.json()).orders);
  }
  useEffect(() => { load().catch((problem) => setError(problem.message)); }, []);
  async function forgetDevice() {
    const response = await fetch("/api/orders/forget-device", { method: "POST" });
    if (!response.ok) { setError("This device could not be forgotten."); return; }
    setMessage("Guest order access was removed from this device.");
    await load().catch((problem) => setError(problem.message));
  }
  async function recover(event) {
    event.preventDefault(); setError(""); setMessage("");
    const response = await fetch("/api/orders/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recovery) });
    const data = await response.json();
    if (!response.ok) { setError(data.message || "Order recovery is unavailable."); return; }
    setMessage(data.message);
  }
  return <section className="section orders-page">
    <p className="eyebrow">YOUR ACCOUNT</p><h1>My Orders</h1>
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {orders === null ? <p role="status">Loading orders…</p> : orders.length ? <div className="customer-order-list">{orders.map((order) => <article className="customer-order-card" key={order.orderNumber}>
      <header><div><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("en-AE")}</small></div><span className={`status-pill ${order.status}`}>{order.status}</span></header>
      <p>{order.productSummary}</p><footer><strong>{money(order.totalFils)}</strong><Link className="text-button" href={`/orders/${order.orderNumber}`}>View details →</Link></footer>
    </article>)}</div> : <div className="empty"><h2>No orders found on this device</h2><p>Guest orders appear here while this device session is valid. You can also recover an order using its number and checkout email.</p><Link href="/shop">Browse the collection</Link></div>}
    <div className="orders-tools"><section className="account-card"><h2>Recover an order</h2><p>We’ll send a one-time verification link to the email used at checkout.</p><form onSubmit={recover}><label>Order number<input required value={recovery.orderNumber} onChange={(e) => setRecovery({ ...recovery, orderNumber: e.target.value.toUpperCase() })} placeholder="DM-00000001" /></label><label>Checkout email<input required type="email" value={recovery.email} onChange={(e) => setRecovery({ ...recovery, email: e.target.value })} /></label><button className="button">Send verification link</button></form></section><section className="account-card"><h2>Guest access</h2><p>Guest orders on this browser are protected by a private, expiring session.</p><button className="button secondary" type="button" onClick={forgetDevice}>Forget this device</button><p><Link href="/account/login">Sign in</Link> or <Link href="/account/register">create an account</Link>.</p></section></div>
  </section>;
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "../../../lib/money";

export default function MyOrdersPage() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    if (!response.ok) throw new Error("Orders could not be loaded.");
    setOrders((await response.json()).orders);
  }
  useEffect(() => { load().catch((problem) => setError(problem.message)); }, []);
  return <section className="section orders-page">
    <p className="eyebrow">YOUR ACCOUNT</p><h1>My Orders</h1>
    {error && <p className="notice error" role="alert">{error}</p>}
    {orders === null ? <p role="status">Loading orders…</p> : orders.length ? <div className="customer-order-list">{orders.map((order) => <article className="customer-order-card" key={order.orderNumber}>
      <header><div><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("en-AE")}</small></div><span className={`status-pill ${order.status}`}>{order.status}</span></header>
      <p>{order.productSummary}</p><footer><strong>{money(order.totalFils)}</strong><Link className="text-button" href={`/orders/${order.orderNumber}`}>View details →</Link></footer>
    </article>)}</div> : <div className="empty"><h2>No orders found on this device</h2><p>Orders appear here while your device session is valid.</p><Link href="/shop">Browse the collection</Link></div>}
  </section>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";
import { useAdmin } from "../AdminShell";
import { paymentLabel, statusLabel } from "./status";
import Pagination from "../Pagination";

export default function AdminOrdersPage() {
  const { request } = useAdmin();
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => request(`/api/admin/orders?${new URLSearchParams({ page, search: query, status: filter })}`)
      .then((data) => { if (!cancelled) { setOrders(data.orders); setTotal(data.total); setPage(data.page); setError(""); } })
      .catch((problem) => { if (!cancelled) setError(problem.message); })
      .finally(() => { if (!cancelled) setLoading(false); }), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [request, reload, page, query, filter]);
  return <section className="admin-page product-management">
    <div className="admin-page-heading"><div><p className="eyebrow">FULFILMENT</p><h1>Orders</h1><p>Review orders and manage fulfilment.</p></div></div>
    {error && <p className="notice error" role="alert">{error} <button className="text-button" onClick={() => setReload(reload + 1)}>Retry</button></p>}
    <div className="product-table-toolbar order-table-toolbar">
      <label>Search orders<input type="search" maxLength="254" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Order number, name, or email" /></label>
      <label>Status<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">All orders</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <span>{total} orders</span>
    </div>
    <div className="product-admin-list">
      {loading ? <p className="admin-empty" role="status">Loading orders…</p> : orders.length ? orders.map((order) => <article className="order-admin-row" key={order.id}>
        <div className="product-admin-info"><strong>{order.orderNumber}</strong><small>{order.name} · {order.email}</small></div>
        <strong className="order-admin-total">{money(order.totalFils)}</strong>
        <span className={`status-pill ${order.status}`}>{statusLabel[order.status]}</span>
        <span className="order-payment">Payment: {paymentLabel[order.paymentStatus]}</span>
        <div className="order-admin-actions"><Link className="product-icon-action" href={`/admin/orders/${order.id}`} aria-label={`Show ${order.orderNumber}`} title="Show order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.5" /></svg></Link><Link className="product-icon-action" href={`/admin/orders/${order.id}/edit`} aria-label={`Edit ${order.orderNumber}`} title="Edit order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.8 3.8-.8L18.5 8a2.1 2.1 0 0 0-3-3L4 16.5ZM14.5 6.5l3 3" /></svg></Link></div>
      </article>) : <p className="admin-empty">{error ? "Orders could not be loaded." : query || filter !== "all" ? "No matching orders." : "No orders yet."}</p>}
    </div>
    {!loading && total > 0 && <Pagination page={page} total={total} pageSize={10} onPageChange={setPage} />}
  </section>;
}

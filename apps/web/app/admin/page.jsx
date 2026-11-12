"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "../../lib/money";
import { useAdmin } from "./AdminShell";

const statusLabel = {
  placed: "New",
  processing: "Preparing",
  shipped: "Dispatched",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function orderActivity(orders) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = dayKey(date);
    return {
      label: new Intl.DateTimeFormat("en", { weekday: "short" }).format(date),
      count: orders.filter((order) => dayKey(new Date(order.createdAt)) === key).length,
    };
  });
}

function ActivityChart({ days }) {
  const maximum = Math.max(...days.map((day) => day.count), 1);
  const points = days.map((day, index) => {
    const x = 24 + index * 58;
    const y = 116 - (day.count / maximum) * 76;
    return `${x},${y}`;
  });
  return (
    <div className="activity-chart" aria-label="Orders received in the last seven days">
      <svg viewBox="0 0 396 144" role="img" aria-hidden="true">
        <line x1="24" x2="372" y1="116" y2="116" />
        <line x1="24" x2="372" y1="78" y2="78" />
        <line x1="24" x2="372" y1="40" y2="40" />
        <polyline points={points.join(" ")} />
        {days.map((day, index) => {
          const [x, y] = points[index].split(",");
          return <circle key={day.label} cx={x} cy={y} r="4" />;
        })}
      </svg>
      <div className="activity-labels">
        {days.map((day) => <span key={day.label}>{day.label}</span>)}
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { request } = useAdmin();
  const [products, setProducts] = useState(null);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([request("/api/admin/products"), request("/api/admin/orders")])
      .then(([catalogue, history]) => {
        if (cancelled) return;
        setProducts(catalogue.products);
        setOrders(history.orders);
        setError("");
      })
      .catch((problem) => {
        if (!cancelled) setError(problem.message);
      });
    return () => { cancelled = true; };
  }, [request, retry]);

  const active = products?.filter((product) => product.isActive) || [];
  const lowStock = active.filter((product) => product.stock <= 5);
  const openOrders = orders?.filter((order) =>
    ["placed", "processing", "shipped"].includes(order.status),
  ) || [];
  const preparing = orders?.filter((order) => order.status === "processing") || [];
  const dispatched = orders?.filter((order) => order.status === "shipped") || [];
  const refunded = orders?.filter((order) => order.refundStatus === "pending") || [];
  const days = useMemo(() => orderActivity(orders || []), [orders]);

  return (
    <section className="admin-page admin-dashboard">
      <div className="admin-page-heading dashboard-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Today’s store</h1>
          <p>Prioritise stock and fulfilment work across your latest 100 orders</p>
        </div>
        <Link href="/admin/orders" className="button small">Review orders</Link>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error} <button className="text-button" onClick={() => setRetry(retry + 1)}>Retry</button>
        </div>
      )}
      {!products && !error && <p role="status">Loading store summary…</p>}
      {products && orders && (
        <>
          <div className="admin-stat-grid">
             <div className="admin-stat"><span>Total products</span><strong>{products.length}</strong><small>Catalogue families</small></div>
             <div className="admin-stat"><span>Active products</span><strong>{active.length}</strong><small>Visible on storefront</small></div>
             <div className="admin-stat"><span>Low stock</span><strong>{lowStock.length}</strong><small>Products with five units or fewer</small></div>
             <div className="admin-stat"><span>Total orders</span><strong>{orders.length}</strong><small>{openOrders.length} still open</small></div>
          </div>

          <div className="dashboard-main-grid">
            <section className="admin-card activity-card">
              <div className="dashboard-card-heading">
                <div><h2>Order activity</h2><p>Orders received in the last seven days</p></div>
                <span className="quiet-count">{orders.length} total</span>
              </div>
              <ActivityChart days={days} />
            </section>
            <section className="admin-card fulfilment-card">
              <div className="dashboard-card-heading"><div><h2>Fulfilment queue</h2><p>What needs attention now</p></div></div>
              <div className="queue-list">
                <Link href="/admin/orders"><span className="queue-dot placed" /><span>New orders</span><strong>{orders.filter((order) => order.status === "placed").length}</strong></Link>
                <Link href="/admin/orders"><span className="queue-dot processing" /><span>Preparing</span><strong>{preparing.length}</strong></Link>
                <Link href="/admin/orders"><span className="queue-dot shipped" /><span>Dispatched</span><strong>{dispatched.length}</strong></Link>
                <Link href="/admin/orders"><span className="queue-dot warning" /><span>Refund follow-up</span><strong>{refunded.length}</strong></Link>
              </div>
            </section>
          </div>

          <div className="dashboard-bottom-grid">
            <section className="admin-card recent-orders-card">
              <div className="dashboard-card-heading"><div><h2>Recent orders</h2><p>Latest customer activity</p></div><Link href="/admin/orders">View all</Link></div>
              {orders.length ? (
                <div className="admin-orders-table" role="table" aria-label="Recent orders">
                  <div className="admin-orders-header" role="row"><span>Order</span><span>Customer</span><span>Status</span><span>Total</span></div>
                  {orders.slice(0, 5).map((order) => (
                    <Link href="/admin/orders" key={order.id} className="admin-orders-row" role="row">
                      <strong>{order.orderNumber}</strong>
                      <span><strong>{order.name}</strong><small>{new Date(order.createdAt).toLocaleDateString("en-AE")}</small></span>
                      <span className={`status-pill ${order.status}`}>{statusLabel[order.status]}</span>
                      <strong>{money(order.totalFils)}</strong>
                    </Link>
                  ))}
                </div>
              ) : <p className="admin-empty">No orders yet.</p>}
            </section>
            <section className="admin-card stock-card">
              <div className="dashboard-card-heading"><div><h2>Inventory watch</h2><p>Products at five units or fewer</p></div><Link href="/admin/products">Manage stock</Link></div>
              {lowStock.length ? lowStock.slice(0, 5).map((product) => <div className="stock-watch-row" key={product.id}><span><strong>{product.name}</strong><small>{product.sku}</small></span><strong>{product.stock}</strong></div>) : <p className="admin-empty">No low-stock products.</p>}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";
import { useAdmin } from "../AdminShell";

const statusLabel = {
  placed: "New order",
  processing: "Preparing",
  shipped: "Dispatched",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function AdminOrdersPage() {
  const { request } = useAdmin();
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [shipment, setShipment] = useState({
    carrier: "",
    trackingNumber: "",
    trackingUrl: "",
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const visibleOrders = orders.filter((order) => {
    if (filter !== "all" && order.status !== filter &&
      !(filter === "refund" && order.refundStatus === "pending")) return false;
    return `#${order.id} ${order.name} ${order.email}`
      .toLowerCase().includes(query.toLowerCase().trim());
  });

  async function refresh(orderId = selected?.id) {
    const list = await request("/api/admin/orders");
    setOrders(list.orders);
    if (orderId) {
      const detail = await request(`/api/admin/orders/${orderId}`);
      setSelected(detail.order);
    }
  }

  useEffect(() => {
    setLoading(true);
    request("/api/admin/orders")
      .then((data) => { setOrders(data.orders); setError(""); })
      .catch((problem) => { setError(problem.message); notify(problem.message, "error"); })
      .finally(() => setLoading(false));
  }, [request, reload]);

  async function select(orderId) {
    try {
      const data = await request(`/api/admin/orders/${orderId}`);
      setSelected(data.order);
      setNote("");
      setShipment({
        carrier: data.order.carrier || "",
        trackingNumber: data.order.trackingNumber || "",
        trackingUrl: data.order.trackingUrl || "",
      });
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeStatus(status) {
    if (
      status === "cancelled" &&
      !confirm("Cancel this order and return its items to stock?")
    )
      return;
    try {
      await request(`/api/admin/orders/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(status === "shipped" && {
            ...shipment,
            trackingUrl: shipment.trackingUrl || null,
          }),
        }),
      });
      await refresh(selected.id);
      notify(`Order marked ${statusLabel[status].toLowerCase()}`);
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function dispatchOrder(event) {
    event.preventDefault();
    changeStatus("shipped");
  }

  async function requestRefund(event) {
    event.preventDefault();
    if (note.trim().length < 10) {
      notify("Refund note must be at least 10 characters", "error");
      focusField(event.currentTarget, "note");
      return;
    }
    try {
      await request(`/api/admin/orders/${selected.id}/refund`, {
        method: "POST", body: JSON.stringify({ note }),
      });
      setNote("");
      await refresh(selected.id);
      notify("Manual refund marked pending");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function completeRefund() {
    if (!confirm("Confirm the refund was completed outside this store?"))
      return;
    try {
      await request(`/api/admin/orders/${selected.id}/refund`, {
        method: "PATCH", body: JSON.stringify({ status: "completed" }),
      });
      await refresh(selected.id);
      notify("Manual refund recorded as complete");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">FULFILMENT</p>
          <h1>Orders</h1>
          <p>Review customer details, update status, and record manual refunds.</p>
        </div>
        <span className="admin-count">Latest {orders.length} orders</span>
      </div>
      <p className="fine-print">Refund actions record work completed outside this store. No money is transferred here.</p>
      {error && <p className="notice error" role="alert">{error} <button className="text-button" onClick={() => setReload(reload + 1)}>Retry</button></p>}
      <div className="admin-grid">
        <aside className="order-list-panel" aria-label="Orders">
          <label className="admin-search-label">Search order, name, or email
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Find an order" />
          </label>
          <label className="admin-filter-label">Status
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setSelected(null); }}>
              <option value="all">All orders</option>
              <option value="placed">New orders</option>
              <option value="processing">Preparing</option>
              <option value="shipped">Dispatched</option>
              <option value="delivered">Delivered</option>
              <option value="completed">Completed (legacy)</option>
              <option value="cancelled">Cancelled</option>
              <option value="refund">Pending refund</option>
            </select>
          </label>
          <div className="order-list">
          {loading ? <p className="admin-empty" role="status">Loading orders…</p> : visibleOrders.length ? (
            visibleOrders.map((order) => (
              <button
                key={order.id}
                className={selected?.id === order.id ? "selected" : ""}
                aria-pressed={selected?.id === order.id}
                onClick={() => select(order.id)}
              >
                <span className="row-between"><strong>#{order.id}</strong><strong>{money(order.totalFils)}</strong></span>
                <span>{order.name}</span>
                <small>{order.email}</small>
                <span className={`status-pill ${order.status}`}>{statusLabel[order.status]}</span>
                {order.refundStatus !== "none" && <span className="status-pill warning">Refund {order.refundStatus}</span>}
              </button>
            ))
          ) : (
            <p className="admin-empty">{error ? "Orders could not be loaded." : orders.length ? "No matching orders." : "No orders yet."}</p>
          )}
          </div>
        </aside>
        {selected && (
          <div className="order-detail">
            <p className="eyebrow">ORDER #{selected.id}</p>
            <div className="row-between"><h2>{selected.name}</h2><span className={`status-pill ${selected.status}`}>{statusLabel[selected.status]}</span></div>
            <p className="fine-print">
              Placed {new Date(selected.createdAt).toLocaleString("en-AE")}
            </p>
            <div className="admin-detail-grid">
              <div><small>CONTACT</small><p>{selected.email}</p></div>
              <div><small>PHONE</small><p>{selected.phone || "Not provided on legacy order"}</p></div>
              <div><small>ADDRESS</small><p>{selected.address}</p></div>
              <div><small>REFUND</small><p>{selected.refundStatus}</p></div>
            </div>
            <h3>Items</h3>
            {selected.items.map((item, index) => (
              <div className="summary-line" key={index}>
                <span>
                  {item.productName}
                  <small>
                    {item.variantLabel} · {item.sku} × {item.quantity}
                  </small>
                </span>
                <strong>{money(item.unitPriceFils * item.quantity)}</strong>
              </div>
            ))}
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(selected.totalFils)}</strong>
            </div>
            <div className="order-actions">
              {selected.status === "placed" && (
                <button
                  className="button small"
                  onClick={() => changeStatus("processing")}
                >
                  Start processing
                </button>
              )}
              {selected.status === "processing" && (
                <form className="shipment-form" onSubmit={dispatchOrder} onInvalid={invalidForm}>
                  <h3>Dispatch order</h3>
                  <p>Enter the carrier details so the customer can follow this order.</p>
                  <div className="field-grid">
                    <label>Carrier
                      <input name="carrier" required maxLength="80" value={shipment.carrier} onChange={(event) => setShipment({ ...shipment, carrier: event.target.value })} placeholder="Aramex" />
                    </label>
                    <label>Tracking number
                      <input name="trackingNumber" required maxLength="120" value={shipment.trackingNumber} onChange={(event) => setShipment({ ...shipment, trackingNumber: event.target.value })} placeholder="1234567890" />
                    </label>
                    <label className="span-two">Tracking link (optional)
                      <input name="trackingUrl" type="url" maxLength="500" value={shipment.trackingUrl} onChange={(event) => setShipment({ ...shipment, trackingUrl: event.target.value })} placeholder="https://carrier.example/track/..." />
                    </label>
                  </div>
                  <button className="button small">Mark as dispatched</button>
                </form>
              )}
              {selected.status === "shipped" && (
                <button className="button small" onClick={() => changeStatus("delivered")}>Mark delivered</button>
              )}
              {["placed", "processing"].includes(selected.status) && (
                <button
                  className="text-button"
                  onClick={() => changeStatus("cancelled")}
                >
                  Cancel and restock
                </button>
              )}
            </div>
            {["delivered", "completed", "cancelled"].includes(selected.status) &&
              selected.refundStatus === "none" && (
                <form
                  onSubmit={requestRefund}
                  onInvalid={invalidForm}
                  className="order-actions"
                >
                  <label>
                    Refund note
                    <textarea
                      name="note"
                      required
                      minLength="10"
                      maxLength="500"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Reason and offline refund reference"
                    />
                  </label>
                  <button className="button small">
                    Request manual refund
                  </button>
                </form>
              )}
            {selected.refundStatus === "pending" && (
              <div className="order-actions">
                <p>Pending manual refund: {selected.refundNote}</p>
                <button className="button small" onClick={completeRefund}>
                  Record refund completed
                </button>
              </div>
            )}
            {selected.refundStatus === "completed" && (
              <p>Manual refund recorded as complete. {selected.refundNote}</p>
            )}
            <section className="order-timeline" aria-label="Order progress">
              <h3>Order progress</h3>
              {selected.events?.length ? (
                <ol>
                  {selected.events.map((event, index) => (
                    <li key={`${event.type}-${event.createdAt}-${index}`}>
                      <span className="timeline-dot" />
                      <div><strong>{event.message}</strong><small>{new Date(event.createdAt).toLocaleString("en-AE")}</small></div>
                    </li>
                  ))}
                </ol>
              ) : <p className="fine-print">Order progress will appear here as staff update it.</p>}
              {selected.trackingNumber && (
                <p className="tracking-summary">
                  <strong>{selected.carrier}</strong> · {selected.trackingNumber}
                  {selected.trackingUrl && <> · <a href={selected.trackingUrl} target="_blank" rel="noopener noreferrer">Open tracking ↗</a></>}
                </p>
              )}
            </section>
          </div>
        )}
        {!selected && <div className="admin-empty-panel">Select an order to view its customer details, items, and available actions.</div>}
      </div>
    </section>
  );
}

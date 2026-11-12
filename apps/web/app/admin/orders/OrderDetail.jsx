"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";
import { useAdmin } from "../AdminShell";
import { nextStatuses, paymentLabel, statusLabel } from "./status";

export default function OrderDetail({ edit = false }) {
  const { id } = useParams();
  const { request } = useAdmin();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [note, setNote] = useState("");
  const [shipment, setShipment] = useState({ carrier: "", trackingNumber: "", trackingUrl: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const data = await request(`/api/admin/orders/${id}`);
    setOrder(data.order);
    setStatus(data.order.status);
    setPayment(data.order.paymentStatus);
    setShipment({ carrier: data.order.carrier || "", trackingNumber: data.order.trackingNumber || "", trackingUrl: data.order.trackingUrl || "" });
    setError("");
  }, [id, request]);
  useEffect(() => { load().catch((problem) => setError(problem.message)).finally(() => setLoading(false)); }, [load]);
  async function update(path, method, body, message) {
    setSaving(true);
    try {
      await request(`/api/admin/orders/${id}/${path}`, { method, body: JSON.stringify(body) });
      await load();
      notify(message);
      return true;
    } catch (problem) { notify(problem.message, "error"); return false; }
    finally { setSaving(false); }
  }
  async function saveStatus(event) {
    event.preventDefault();
    if (status === order.status) return;
    if (status === "cancelled" && !confirm("Cancel this order and return its items to stock?")) return;
    await update("status", "PATCH", { status, ...(["shipped", "delivered"].includes(status) ? { ...shipment, trackingUrl: shipment.trackingUrl || null } : {}) }, "Order status updated");
  }
  async function savePayment(event) {
    event.preventDefault();
    if (payment !== order.paymentStatus) await update("payment-status", "PATCH", { status: payment }, "Payment status updated");
  }
  async function requestRefund(event) {
    event.preventDefault();
    if (note.trim().length < 10) { notify("Refund note must be at least 10 characters", "error"); focusField(event.currentTarget, "note"); return; }
    if (await update("refund", "POST", { note }, "Manual refund marked pending")) setNote("");
  }
  async function completeRefund() {
    if (confirm("Confirm the refund was completed outside this store?")) await update("refund", "PATCH", { status: "completed" }, "Manual refund recorded as complete");
  }
  if (loading) return <p role="status">Loading order...</p>;
  if (error || !order) return <section className="admin-page"><p className="notice error" role="alert">{error || "Order not found"}</p><Link href="/admin/orders">Back to orders</Link><button className="text-button" onClick={() => { setLoading(true); load().catch((problem) => setError(problem.message)).finally(() => setLoading(false)); }}>Retry</button></section>;
  const trackingNeeded = ["shipped", "delivered"].includes(status) && status !== order.status;
  return <section className="admin-page order-page">
    <div className="admin-page-heading no-print"><div><p className="eyebrow">FULFILMENT</p><h1>{edit ? "Edit order" : "Order details"}</h1><Link href="/admin/orders">Back to orders</Link></div><div className="button-row">{edit ? <Link className="button small secondary" href={`/admin/orders/${id}`}>Show order</Link> : <><Link className="button small secondary" href={`/admin/orders/${id}/edit`}>Edit order</Link><button className="button small" type="button" onClick={() => window.print()}>Print receipt</button></>}</div></div>
    <div className="order-detail receipt">
      <p className="eyebrow">DANUBE MILANO / RECEIPT</p>
      <div className="row-between"><h2>{order.orderNumber}</h2><span className={`status-pill ${order.status}`}>{statusLabel[order.status]}</span></div>
      <p className="fine-print">Placed {new Date(order.createdAt).toLocaleString("en-AE")}</p>
      <div className="admin-detail-grid"><div><small>CUSTOMER</small><p>{order.name}</p></div><div><small>CONTACT</small><p>{order.email}</p></div><div><small>PHONE</small><p>{order.phone || "Not provided on legacy order"}</p></div><div><small>ADDRESS</small><p>{order.address}</p></div><div><small>PAYMENT</small><p>Cash on delivery / {paymentLabel[order.paymentStatus]}</p></div><div><small>REFUND</small><p>{order.refundStatus}</p></div></div>
      <h3>Items</h3>{order.items.map((item, index) => <div className="summary-line" key={index}><span>{item.productName}<small>SKU: {item.sku} x {item.quantity} / {money(item.unitPriceFils)} each</small></span><strong>{money(item.unitPriceFils * item.quantity)}</strong></div>)}<div className="summary-total"><span>Total</span><strong>{money(order.totalFils)}</strong></div>
      {order.trackingNumber && <p className="tracking-summary"><strong>{order.carrier}</strong> / {order.trackingNumber}{order.trackingUrl && <> / <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Open tracking</a></>}</p>}
      {order.refundNote && <p className="no-print">Manual refund {order.refundStatus}: {order.refundNote}</p>}
      {edit && <div className="no-print order-edit-actions">
        <form className="order-actions" onSubmit={saveStatus} onInvalid={invalidForm}><h3>Order status</h3><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value={order.status}>{statusLabel[order.status]}</option>{(nextStatuses[order.status] || []).map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label>
          {trackingNeeded && <div className="field-grid"><label>Carrier<input name="carrier" required maxLength="80" value={shipment.carrier} onChange={(event) => setShipment({ ...shipment, carrier: event.target.value })} /></label><label>Tracking number<input name="trackingNumber" required maxLength="120" value={shipment.trackingNumber} onChange={(event) => setShipment({ ...shipment, trackingNumber: event.target.value })} /></label><label className="span-two">Tracking link (optional)<input name="trackingUrl" type="url" maxLength="500" value={shipment.trackingUrl} onChange={(event) => setShipment({ ...shipment, trackingUrl: event.target.value })} /></label></div>}
          <button className="button small" disabled={saving || status === order.status}>Save order status</button></form>
        <form className="order-actions" onSubmit={savePayment}><h3>Payment status</h3><p className="fine-print">This records payment manually; no money is transferred.</p><label>Status<select value={payment} onChange={(event) => setPayment(event.target.value)}>{order.paymentStatus === "unknown" && <option value="unknown">Not recorded (older order)</option>}<option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></label><button className="button small" disabled={saving || payment === order.paymentStatus}>Save payment status</button></form>
        <div className="order-actions"><h3>Manual refund</h3><p className="fine-print">Refund actions record work completed outside this store. No money is transferred here.</p>
          {["delivered", "completed", "cancelled"].includes(order.status) && order.refundStatus === "none" && <form onSubmit={requestRefund} onInvalid={invalidForm}><label>Refund note<textarea name="note" required minLength="10" maxLength="500" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reason and offline refund reference" /></label><button className="button small" disabled={saving}>Request manual refund</button></form>}
          {order.refundStatus === "pending" && <button className="button small" disabled={saving} onClick={completeRefund}>Record refund completed</button>}
          {order.refundStatus === "none" && !["delivered", "completed", "cancelled"].includes(order.status) && <p>Refunds can be recorded after delivery or cancellation.</p>}
        </div>
      </div>}
      <section className="order-timeline no-print" aria-label="Order progress"><h3>Order progress</h3>{order.events?.length ? <ol>{order.events.map((event, index) => <li key={`${event.type}-${event.createdAt}-${index}`}><span className="timeline-dot" /><div><strong>{event.message}</strong><small>{new Date(event.createdAt).toLocaleString("en-AE")}</small></div></li>)}</ol> : <p className="fine-print">Order progress will appear here as staff update it.</p>}</section>
    </div>
  </section>;
}

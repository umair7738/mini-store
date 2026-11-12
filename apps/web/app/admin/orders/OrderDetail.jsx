"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { money } from "../../../lib/money";
import { formatDate } from "../../../lib/dates";
import { invalidForm, notify } from "../../Toast";
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
  const [shipment, setShipment] = useState({ carrier: "", trackingNumber: "", trackingUrl: "" });
  const [correctingDispatch, setCorrectingDispatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const data = await request(`/api/admin/orders/${id}`);
    setOrder(data.order);
    setStatus(data.order.status);
    setPayment(data.order.paymentStatus);
    setShipment({ carrier: data.order.carrier || "", trackingNumber: data.order.trackingNumber || "", trackingUrl: data.order.trackingUrl || "" });
    setCorrectingDispatch(false);
    setError("");
  }, [id, request]);
  useEffect(() => { load().catch((problem) => setError(problem.message)).finally(() => setLoading(false)); }, [load]);
  async function saveChanges(event) {
    event.preventDefault();
    const trackingChanged = correctingDispatch && ["carrier", "trackingNumber", "trackingUrl"].some((key) => shipment[key] !== (order[key] || ""));
    if (status === order.status && payment === order.paymentStatus && !trackingChanged) return;
    if (status === "cancelled" && !confirm("Cancel this order and return its items to stock?")) return;
    setSaving(true);
    try {
      if (status !== order.status) await request(`/api/admin/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(["shipped", "delivered"].includes(status) ? { ...shipment, trackingUrl: shipment.trackingUrl || null } : {}) }) });
      else if (trackingChanged) await request(`/api/admin/orders/${id}/tracking`, { method: "PATCH", body: JSON.stringify({ ...shipment, trackingUrl: shipment.trackingUrl || null }) });
      if (payment !== order.paymentStatus) await request(`/api/admin/orders/${id}/payment-status`, { method: "PATCH", body: JSON.stringify({ status: payment }) });
      await load();
      notify("Order updated");
    } catch (problem) { await load().catch(() => {}); notify(problem.message, "error"); }
    finally { setSaving(false); }
  }
  if (loading) return <p role="status">Loading order...</p>;
  if (error || !order) return <section className="admin-page"><p className="notice error" role="alert">{error || "Order not found"}</p><Link href="/admin/orders">Back to orders</Link><button className="text-button" onClick={() => { setLoading(true); load().catch((problem) => setError(problem.message)).finally(() => setLoading(false)); }}>Retry</button></section>;
  const trackingChanged = correctingDispatch && ["carrier", "trackingNumber", "trackingUrl"].some((key) => shipment[key] !== (order[key] || ""));
  const trackingNeeded = (["shipped", "delivered"].includes(status) && status !== order.status) || (status === "shipped" && order.status === "shipped" && correctingDispatch);
  return <section className="admin-page order-page">
    <div className="admin-page-heading no-print"><div><p className="eyebrow">FULFILMENT</p><h1>{edit ? "Edit order" : "Order details"}</h1><Link href="/admin/orders">Back to orders</Link></div><div className="button-row">{edit ? <Link className="button small secondary" href={`/admin/orders/${id}`}>Show order</Link> : <><Link className="button small secondary" href={`/admin/orders/${id}/edit`}>Edit order</Link><button className="button small" type="button" onClick={() => window.print()}>Print receipt</button></>}</div></div>
    {edit && <form className="no-print order-actions" onSubmit={saveChanges} onInvalid={invalidForm}><h3>Update order <small>Payment status is a manual record; no money is transferred.</small></h3><div className="order-status-fields"><label>Order status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value={order.status}>{statusLabel[order.status]}</option>{(nextStatuses[order.status] || []).map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label><label>Payment status<select value={payment} onChange={(event) => setPayment(event.target.value)}>{order.paymentStatus === "unknown" && <option value="unknown">Not recorded (older order)</option>}<option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></label>{order.status === "shipped" && status === "shipped" && <button type="button" className="text-button" aria-expanded={correctingDispatch} onClick={() => { if (correctingDispatch) setShipment({ carrier: order.carrier || "", trackingNumber: order.trackingNumber || "", trackingUrl: order.trackingUrl || "" }); setCorrectingDispatch(!correctingDispatch); }}>{correctingDispatch ? "Cancel correction" : "Correct dispatch details"}</button>}<button className="button small" disabled={saving || (status === order.status && payment === order.paymentStatus && !trackingChanged)}>{saving ? "Saving…" : "Save changes"}</button></div>
      {trackingNeeded && <div className="order-tracking-fields"><label>Carrier<input name="carrier" required maxLength="80" value={shipment.carrier} onChange={(event) => setShipment({ ...shipment, carrier: event.target.value })} /></label><label>Tracking number<input name="trackingNumber" required maxLength="120" value={shipment.trackingNumber} onChange={(event) => setShipment({ ...shipment, trackingNumber: event.target.value })} /></label><label>Tracking link (optional)<input name="trackingUrl" type="url" maxLength="500" value={shipment.trackingUrl} onChange={(event) => setShipment({ ...shipment, trackingUrl: event.target.value })} /></label></div>}
    </form>}
    <div className="order-detail receipt">
      <p className="eyebrow">DANUBE MILANO / RECEIPT</p>
      <div className="row-between"><h2>{order.orderNumber}</h2><span className={`status-pill ${order.status}`}>{statusLabel[order.status]}</span></div>
      <p className="fine-print">Placed {formatDate(order.createdAt, { dateStyle: "short", timeStyle: "short" })}</p>
      <div className="admin-detail-grid"><div><small>CUSTOMER</small><p>{order.name}</p></div><div><small>CONTACT</small><p>{order.email}</p></div><div><small>PHONE</small><p>{order.phone || "Not provided on legacy order"}</p></div><div><small>ADDRESS</small><p>{order.address}</p></div><div><small>PAYMENT</small><p>Cash on delivery / {paymentLabel[order.paymentStatus]}</p></div></div>
      <h3>Items</h3>{order.items.map((item, index) => <div className="summary-line" key={index}><span>{item.productName}<small>SKU: {item.sku} x {item.quantity} / {money(item.unitPriceFils)} each</small></span><strong>{money(item.unitPriceFils * item.quantity)}</strong></div>)}<div className="summary-total"><span>Total</span><strong>{money(order.totalFils)}</strong></div>
      {order.trackingNumber && <p className="tracking-summary"><strong>{order.carrier}</strong> / {order.trackingNumber}{order.trackingUrl && <> / <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Open tracking</a></>}</p>}
      <section className="order-timeline no-print" aria-label="Order progress"><h3>Order progress</h3>{order.events?.length ? <ol>{order.events.map((event, index) => <li key={`${event.type}-${event.createdAt}-${index}`}><span className="timeline-dot" /><div><strong>{event.message}</strong><small>{formatDate(event.createdAt, { dateStyle: "short", timeStyle: "short" })}</small></div></li>)}</ol> : <p className="fine-print">Order progress will appear here as staff update it.</p>}</section>
    </div>
  </section>;
}

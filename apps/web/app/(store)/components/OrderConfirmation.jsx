"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";

const progress = [["placed", "Order placed"], ["processing", "Preparing"], ["shipped", "Dispatched"], ["delivered", "Delivered"]];

function progressIndex(status) {
  if (status === "completed") return 3;
  return progress.findIndex(([value]) => value === status);
}

export default function OrderConfirmation({ orderId }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) {
      setError("This confirmation is unavailable.");
      return;
    }
    fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("This confirmation is invalid or has expired.");
        return response.json();
      })
      .then((data) => setOrder(data.order))
      .catch((problem) => setError(problem.message));
  }, [orderId]);

  return (
    <section className="section narrow">
      <p className="eyebrow">ORDER CONFIRMATION</p>
      {error ? <div className="empty"><h1>Confirmation unavailable</h1><p>{error}</p><Link href="/shop">Return to shop</Link></div> : !order ? <p role="status">Loading confirmation…</p> : (
        <>
          <h1>Order placed successfully.</h1>
          <p className="lead">Your order {order.orderNumber} is confirmed.</p>
          {order.status === "cancelled" ? <div className="order-status-card cancelled"><h2>Order cancelled</h2><p>This order was cancelled. Contact the store if you need help.</p></div> : (
            <section className="order-status-card" aria-label="Order progress">
              <h2>Order progress</h2>
              <ol className="customer-progress">{progress.map(([status, label], index) => <li className={index <= progressIndex(order.status) ? "done" : ""} key={status}><span>{index + 1}</span>{label}</li>)}</ol>
              {order.trackingNumber && <p className="customer-tracking"><strong>{order.carrier}</strong> tracking: {order.trackingNumber}{order.trackingUrl && <> · <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track shipment ↗</a></>}</p>}
            </section>
          )}
          <div className="summary">
            <h2>Order {order.orderNumber}</h2>
            <p>Placed {new Date(order.createdAt).toLocaleString("en-AE")}</p>
            {order.items.map((item, index) => <div className="summary-line" key={index}><span>{item.productName}<small>SKU: {item.sku} × {item.quantity}</small></span><strong>{money(item.unitPriceFils * item.quantity)}</strong></div>)}
            <div className="summary-total"><span>Total</span><strong>{money(order.totalFils)}</strong></div>
          </div>
          <div className="order-confirmation-actions"><Link className="button" href={`/orders/${order.orderNumber}`}>View order</Link><Link className="button secondary" href="/orders">My Orders</Link><Link className="text-button" href="/shop">Continue shopping</Link></div>
        </>
      )}
    </section>
  );
}

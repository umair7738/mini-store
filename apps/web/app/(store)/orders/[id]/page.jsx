"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { money } from "../../../../lib/money";

const progress = [
  ["placed", "Order placed"],
  ["processing", "Preparing"],
  ["shipped", "Dispatched"],
  ["delivered", "Delivered"],
];

function progressIndex(status) {
  if (status === "completed") return 3;
  return progress.findIndex(([value]) => value === status);
}

export default function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = sessionStorage.getItem(`order:${id}`);
    if (!token) {
      setError("This confirmation is unavailable in this browser tab.");
      return;
    }
    fetch(`/api/orders/${id}`, { headers: { "X-Order-Token": token } })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("This confirmation is invalid or has expired.");
        return response.json();
      })
      .then((data) => setOrder(data.order))
      .catch((error) => setError(error.message));
  }, [id]);
  return (
    <section className="section narrow">
      <p className="eyebrow">ORDER CONFIRMATION</p>
      {error ? (
        <div className="empty">
          <h1>Confirmation unavailable</h1>
          <p>{error}</p>
          <Link href="/">Return to shop</Link>
        </div>
      ) : !order ? (
        <p>Loading confirmation…</p>
      ) : (
        <>
          <h1>Thank you, {order.name}.</h1>
          <p className="lead">
            Your order #{order.id} is {order.status === "placed" ? "confirmed" : order.status}. This confirmation is available here for 24 hours in this browser tab.
          </p>
          {order.status === "cancelled" ? (
            <div className="order-status-card cancelled">
              <h2>Order cancelled</h2>
              <p>This order was cancelled. Contact the store if you need help.</p>
            </div>
          ) : (
            <section className="order-status-card" aria-label="Order progress">
              <h2>Order progress</h2>
              <ol className="customer-progress">
                {progress.map(([status, label], index) => (
                  <li className={index <= progressIndex(order.status) ? "done" : ""} key={status}>
                    <span>{index + 1}</span>{label}
                  </li>
                ))}
              </ol>
              {order.trackingNumber && (
                <p className="customer-tracking">
                  <strong>{order.carrier}</strong> tracking: {order.trackingNumber}
                  {order.trackingUrl && <> · <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track shipment ↗</a></>}
                </p>
              )}
            </section>
          )}
          <div className="summary">
            <h2>Order #{order.id}</h2>
            <p>
              Current status: {order.status}
              {order.refundStatus !== "none"
                ? ` · Refund: ${order.refundStatus}`
                : ""}
            </p>
            {order.items.map((item, index) => (
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
              <strong>{money(order.totalFils)}</strong>
            </div>
            <p>Delivery address: {order.address}</p>
            <p>Email: {order.email}</p>
          </div>
          <Link className="button" href="/">
            Continue shopping
          </Link>
        </>
      )}
    </section>
  );
}

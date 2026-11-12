"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePending } from "../../usePending";
import { money } from "../../../lib/money";
import { notify } from "../../Toast";
import ProductImage from "../components/ProductImage";

export default function CartPage() {
  const [busy, run] = usePending();
  const [navigating, setNavigating] = useState(false);
  const navigationLock = useRef(false);
  const [cart, setCart] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/cart")
      .then((response) => {
        if (!response.ok) throw new Error("Cart is unavailable");
        return response.json();
      })
      .then(setCart)
      .catch(() => setError("Cart is unavailable"));
  }, []);

  async function change(productId, quantity) {
    const remove = quantity === 0;
    try {
      const response = await fetch(`/api/cart/items/${productId}`, {
        method: remove ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(!remove && { body: JSON.stringify({ quantity }) }),
      });
      const data = await response.json();
      if (response.ok) {
        setCart(data);
        window.dispatchEvent(new Event("cart-updated"));
        setError("");
        notify(remove ? "Item removed" : "Quantity updated");
      } else {
        setError(data.message);
        notify(data.message, "error");
      }
    } catch {
      setError("Cart is unavailable. Please try again.");
      notify("Cart is unavailable. Please try again.", "error");
    }
  }

  const checkoutBlocked = cart?.items.some((item) => item.quantity > 20 || !item.available || item.quantity > item.stock);

  return (
    <section className="section narrow cart-page">
      <p className="eyebrow">YOUR SELECTION</p>
      <h1>Shopping cart</h1>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!cart ? (
        error ? null : <p>Loading cart…</p>
      ) : !cart.items.length ? (
        <div className="empty">
          <p>Your cart is empty.</p>
          <Link className="button" href="/">
            Explore products
          </Link>
        </div>
      ) : (
        <>
          {checkoutBlocked && (
            <p className="notice error" role="alert">Review unavailable items and quantities of 20 or less before checkout.</p>
          )}
          <div className="cart-layout">
            <div className="cart-list">
              {cart.items.map((item) => (
              <article className="cart-row" key={item.productId}>
                  <ProductImage src={item.imageUrl} alt={item.productName} className="cart-thumbnail" />
                  <div className="cart-product-copy">
                    <Link href={`/products/${item.productSlug}`}>
                      <h2>{item.productName}</h2>
                    </Link>
                    <p><span className="cart-meta-label">SKU:</span> {item.sku}</p>
                    <p>{money(item.priceFils)} each</p>
                    {!item.available && (
                      <p className="error">No longer available</p>
                    )}
                  </div>
                  <div className="cart-controls">
                    <div className="cart-quantity" aria-label={`Quantity for ${item.productName}`}>
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${item.productName}`}
                        disabled={busy || item.quantity <= 1}
                        onClick={() => run(() => change(item.productId, item.quantity - 1))}
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${item.productName}`}
                        disabled={busy || item.quantity >= Math.min(20, item.stock)}
                        onClick={() => run(() => change(item.productId, item.quantity + 1))}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="cart-delete"
                      aria-label={`Remove ${item.productName} from cart`}
                      title="Remove item"
                      disabled={busy}
                      onClick={() => run(() => change(item.productId, 0))}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v5m4-5v5" />
                      </svg>
                    </button>
                    <strong>{money(item.lineTotalFils)}</strong>
                  </div>
                </article>
              ))}
            </div>
            <aside className="cart-summary-card">
              <h2>Order Summary</h2>
              <div className="summary-line">
                <span>Subtotal</span>
                <strong>{money(cart.totalFils)}</strong>
              </div>
              <div className="summary-total">
                <span>Total</span>
                <strong>{money(cart.totalFils)}</strong>
              </div>
              <Link
                className="button"
                aria-disabled={checkoutBlocked || busy || navigating}
                href={checkoutBlocked ? "/cart" : "/checkout"}
                onNavigate={(event) => {
                  if (checkoutBlocked || busy || navigationLock.current) { event.preventDefault(); return; }
                  navigationLock.current = true;
                  setNavigating(true);
                }}
              >
                Checkout
              </Link>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

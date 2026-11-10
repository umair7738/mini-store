"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";

export default function CartPage() {
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

  async function change(variantId, quantity, form) {
    const remove = quantity === 0;
    try {
      const response = await fetch(`/api/cart/items/${variantId}`, {
        method: remove ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(!remove && { body: JSON.stringify({ quantity }) }),
      });
      const data = await response.json();
      if (response.ok) {
        setCart(data);
        setError("");
        notify(remove ? "Item removed" : "Quantity updated");
      } else {
        setError(data.message);
        notify(data.message, "error");
        if (form) focusField(form, "quantity");
      }
    } catch {
      setError("Cart is unavailable. Please try again.");
      notify("Cart is unavailable. Please try again.", "error");
    }
  }

  return (
    <section className="section narrow">
      <p className="eyebrow">YOUR SELECTION</p>
      <h1>Shopping cart</h1>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!cart ? (
        <p>Loading cart…</p>
      ) : !cart.items.length ? (
        <div className="empty">
          <p>Your cart is empty.</p>
          <Link className="button" href="/">
            Explore products
          </Link>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {cart.items.map((item) => (
              <article className="cart-row" key={item.variantId}>
                <div>
                  <Link href={`/products/${item.productSlug}`}>
                    <h2>{item.productName}</h2>
                  </Link>
                  <p>
                    {item.variantLabel} · {item.sku}
                  </p>
                  <p>{money(item.priceFils)} each</p>
                  {!item.available && (
                    <p className="error">No longer available</p>
                  )}
                </div>
                <div className="cart-controls">
                  <form
                    onInvalid={invalidForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      change(
                        item.variantId,
                        Number(
                          event.currentTarget.elements.namedItem("quantity")
                            .value,
                        ),
                        event.currentTarget,
                      );
                    }}
                  >
                    <label>
                      Qty{" "}
                      <input
                        key={item.quantity}
                        name="quantity"
                        aria-label={`Quantity for ${item.productName} ${item.variantLabel}`}
                        type="number"
                        min="1"
                        max={Math.min(99, item.stock)}
                        step="1"
                        required
                        defaultValue={item.quantity}
                      />
                    </label>
                    <button className="text-button">Update</button>
                  </form>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => change(item.variantId, 0)}
                  >
                    Remove
                  </button>
                  <strong>{money(item.lineTotalFils)}</strong>
                </div>
              </article>
            ))}
          </div>
          <div className="cart-total">
            <span>Subtotal</span>
            <strong>{money(cart.totalFils)}</strong>
          </div>
          <p className="fine-print">
            Final prices and stock are confirmed at checkout.
          </p>
          <Link className="button" href="/checkout">
            Continue to checkout
          </Link>
        </>
      )}
    </section>
  );
}

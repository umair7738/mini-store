"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function loadCart() {
    const response = await fetch("/api/cart");
    if (!response.ok) throw new Error("Cart is unavailable");
    setCart(await response.json());
  }
  useEffect(() => {
    loadCart().catch(() => setError("Cart is unavailable"));
  }, []);

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!cart?.items.length || busy) return;
    for (const field of ["name", "address"]) {
      if (!form[field].trim()) {
        notify(`Please enter your ${field}`, "error");
        focusField(formElement, field);
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const requestKey = idempotencyKey || crypto.randomUUID();
      if (!idempotencyKey) setIdempotencyKey(requestKey);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          expectedTotalFils: cart.totalFils,
          idempotencyKey: requestKey,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          data.code === "PRICE_CHANGED"
            ? "Prices changed. Review the updated total before submitting again."
            : data.message;
        setError(message);
        notify(message, "error");
        await loadCart();
        if (data.code === "PRICE_CHANGED") {
          const summary = document.querySelector(".summary");
          summary?.scrollIntoView({ behavior: "smooth", block: "center" });
          summary?.focus({ preventScroll: true });
        }
        return;
      }
      sessionStorage.setItem(`order:${data.orderId}`, data.confirmationToken);
      notify("Order placed successfully");
      router.push(`/orders/${data.orderId}`);
    } catch {
      setError("Checkout could not be completed. Please try again.");
      notify("Checkout could not be completed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section narrow">
      <p className="eyebrow">FINAL STEP</p>
      <h1>Checkout</h1>
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
          <Link href="/">Return to shop</Link>
        </div>
      ) : (
        <div className="checkout-grid">
          <form
            onSubmit={submit}
            onInvalid={invalidForm}
            className="form-panel"
          >
            <h2>Your details</h2>
            <label>
              Full name
              <input
                name="name"
                required
                maxLength="120"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label>
              Email
              <input
                name="email"
                required
                type="email"
                maxLength="254"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
            <label>
              Phone
              <input
                name="phone"
                required
                type="tel"
                minLength="7"
                maxLength="30"
                pattern="[+0-9().\\-\\s]+"
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </label>
            <label>
              Delivery address
              <textarea
                name="address"
                required
                minLength="10"
                maxLength="500"
                value={form.address}
                onChange={(event) =>
                  setForm({ ...form, address: event.target.value })
                }
              />
            </label>
            <button className="button" disabled={busy}>
              {busy
                ? "Placing order…"
                : `Place order · ${money(cart.totalFils)}`}
            </button>
          </form>
          <aside className="summary" tabIndex="-1">
            <h2>Order summary</h2>
            {cart.items.map((item) => (
              <div className="summary-line" key={item.variantId}>
                <span>
                  {item.productName}
                  <small>
                    {item.variantLabel} × {item.quantity}
                  </small>
                </span>
                <strong>{money(item.lineTotalFils)}</strong>
              </div>
            ))}
            <div className="summary-total">
              <span>Total</span>
              <strong>{money(cart.totalFils)}</strong>
            </div>
            <p className="fine-print">
              Prices and stock are rechecked when you place the order.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}

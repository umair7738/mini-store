"use client";

import { apiFetch } from "../../../lib/apiFetch";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePending } from "../../usePending";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";
import { useCart } from "../components/CartProvider";
import ProductImage from "../components/ProductImage";

const pendingStorageKey = "mini-checkout-pending-v1";
const terminalCodes = [
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "ITEM_UNAVAILABLE",
  "CART_CHANGED",
  "CART_EXPIRED",
  "CART_EMPTY",
  "QUANTITY_LIMIT",
  "CART_ALREADY_CHECKED_OUT",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_EXPIRED",
  "IDEMPOTENCY_LEGACY_RETRY_REQUIRED",
];

export default function CheckoutPage({ buyNow = "", buyNowQuantity = "1", attempt = "", intent = "" }) {
  const router = useRouter();
  const shared = useCart();
  const [cart, setCart] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [attemptId, setAttemptId] = useState(attempt);
  const [pendingAttempt, setPendingAttempt] = useState(null);
  const [pendingGate, setPendingGate] = useState(null);
  const [buyNowFailed, setBuyNowFailed] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [readyVersion, setReadyVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, run] = usePending();
  const [navigating, setNavigating] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [addresses, setAddresses] = useState([]);
  function clearPending() {
    try { window.sessionStorage.removeItem(pendingStorageKey); } catch {}
    setPendingAttempt(null);
    setPendingGate(null);
    setIdempotencyKey("");
  }

  function beginNewAttempt() {
    clearPending();
    const nextAttempt = crypto.randomUUID();
    setAttemptId(nextAttempt);
    const url = new URL(window.location.href);
    url.searchParams.set("attempt", nextAttempt);
    window.history.replaceState({}, "", url);
    setReadyVersion((version) => version + 1);
  }

  useEffect(() => {
    let saved = null;
    try { saved = JSON.parse(window.sessionStorage.getItem(pendingStorageKey) || "null"); } catch {}
    if (saved?.attemptId) {
      setAttemptId(saved.attemptId);
      setIdempotencyKey(saved.idempotencyKey || "");
      setPendingAttempt(saved);
      setPendingGate(saved);
      setInitialized(true);
      return;
    }
    const activeAttempt = attempt || crypto.randomUUID();
    setAttemptId(activeAttempt);
    if (buyNow) setIdempotencyKey(activeAttempt);
    if (!attempt) {
      const url = new URL(window.location.href);
      url.searchParams.set("attempt", activeAttempt);
      window.history.replaceState({}, "", url);
    }
    setInitialized(true);
  }, [attempt, buyNow]);

  async function loadCart() {
    await shared.store.load();
    const snapshot = shared.store.getSnapshot();
    if (snapshot.unresolved) throw new Error(snapshot.error);
    setCart(snapshot.cart);
  }
  useEffect(() => {
    if (!initialized || pendingGate) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const sessionResponse = await apiFetch("/api/customer/session", { cache: "no-store" });
        const session = sessionResponse.ok ? (await sessionResponse.json()).customer : null;
        if (!cancelled && session) {
          setCustomer(session);
          setForm((current) => ({ ...current, name: session.name || "", email: session.email || "", phone: session.phone || "" }));
          const addressResponse = await apiFetch("/api/customer/addresses", { cache: "no-store" });
          if (addressResponse.ok && !cancelled) setAddresses((await addressResponse.json()).addresses);
        }
        if (buyNow) {
          const response = await apiFetch(`/api/products/${encodeURIComponent(buyNow)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("This product is unavailable");
          const product = (await response.json()).product;
          const quantity = Number(buyNowQuantity);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Choose a quantity from 1 to 20.");
          const item = { productId: product.id, productName: product.name, sku: product.sku, imageUrl: product.imageUrl, priceFils: product.priceFils, lineTotalFils: product.priceFils * quantity, quantity, stock: product.stock, available: true };
          if (!cancelled) {
            setCart({ items: [item], totalFils: item.lineTotalFils });
            if (product.stock < quantity) setError(`Only ${product.stock} available. Reduce the quantity to continue.`);
          }
        } else await loadCart();
      } catch (problem) {
        if (!cancelled) setError(problem.message || "Cart is unavailable");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [attemptId, buyNow, buyNowQuantity, initialized, intent, pendingGate, readyVersion]);

  async function reconcile(record) {
    if (!record?.body) return;
    setError("");
    try {
      const response = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record.body),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.code === "PRICE_CHANGED" ? "Prices changed. Review the updated total before submitting again." : data.message;
        setError(message);
        notify(message, "error");
        if (terminalCodes.includes(data.code)) {
          if (buyNow) { clearPending(); setBuyNowFailed(true); }
          else beginNewAttempt();
        }
        else setPendingGate(record);
        return;
      }
      clearPending();
      notify("Order placed successfully");
      if (!buyNow) shared.store.replace({ items: [], totalFils: 0 });
      else await shared.store.load(true);
      setNavigating(true);
      router.push(`/orders/${data.orderNumber}`);
    } catch {
      setPendingGate(record);
      setError("Checkout state is uncertain. Resolve the previous attempt before starting another.");
      notify("Checkout state is uncertain. Resolve the previous attempt before starting another.", "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if ((!buyNow && (shared.pending || shared.unresolved)) || !cart?.items.length || busy) return;
    for (const field of ["name", "address"]) {
      if (!form[field].trim()) {
        notify(`Please enter your ${field}`, "error");
        focusField(formElement, field);
        return;
      }
    }
    setError("");
    const unavailableItem = cart.items.find((item) => !item.available || item.quantity > item.stock);
    if (unavailableItem) {
      setError(`Only ${unavailableItem.stock} available for ${unavailableItem.productName}.`);
      return;
    }
    const requestKey = idempotencyKey || crypto.randomUUID();
    const body = {
      ...form,
      expectedTotalFils: cart.totalFils,
      idempotencyKey: requestKey,
      ...(buyNow && { buyNow: { productId: cart.items[0].productId, quantity: Number(buyNowQuantity), intent } }),
    };
    const pending = { attemptId, idempotencyKey: requestKey, body, createdAt: Date.now() };
    try { window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(pending)); } catch {}
    setPendingAttempt(pending);
    setIdempotencyKey(requestKey);
    try {
      const response = await apiFetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          data.code === "PRICE_CHANGED"
            ? "Prices changed. Review the updated total before submitting again."
            : data.message;
        setError(message);
        notify(message, "error");
        if (!buyNow) await loadCart();
        if (terminalCodes.includes(data.code)) {
          if (buyNow) { clearPending(); setBuyNowFailed(true); }
          else beginNewAttempt();
        }
        else setPendingGate(pending);
        if (data.code === "PRICE_CHANGED") {
          const summary = document.querySelector(".summary");
          summary?.scrollIntoView({ behavior: "smooth", block: "center" });
          summary?.focus({ preventScroll: true });
        }
        return;
      }
      notify("Order placed successfully");
      clearPending();
      if (!buyNow) shared.store.replace({ items: [], totalFils: 0 });
      else await shared.store.load(true);
      setNavigating(true);
      router.push(`/orders/${data.orderNumber}`);
    } catch {
      setPendingGate(pending);
      setError("Checkout state is uncertain. Resolve the previous attempt before starting another.");
      notify("Checkout state is uncertain. Resolve the previous attempt before starting another.", "error");
    }
  }

  return (
    <section className="section narrow">
      <p className="eyebrow">FINAL STEP</p>
      <h1>Checkout</h1>
      {error && (
        <p className="notice error" role="alert">
          {error}{buyNow && (buyNowFailed || cart?.items.some((item) => item.quantity > item.stock)) && <> <Link href={`/products/${encodeURIComponent(buyNow)}`}>Return to product</Link> and start Buy Now again.</>}
        </p>
      )}
      {pendingGate ? (
        <div className="empty">
          <p>A previous checkout attempt may have completed. Resolve it before starting another purchase.</p>
          <button className="button" type="button" onClick={() => run(() => reconcile(pendingGate))} disabled={busy || navigating}>
            {busy ? "Checking order status…" : "Resolve previous checkout"}
          </button>
        </div>
      ) : !cart ? (
        <p>Loading cart…</p>
      ) : !cart.items.length ? (
        <div className="empty">
          <p>Your cart is empty.</p>
          <Link href="/">Return to shop</Link>
        </div>
      ) : (
        <div className="checkout-grid">
          <form
            onSubmit={(event) => { event.preventDefault(); run(() => submit(event)); }}
            onInvalid={invalidForm}
            className="form-panel"
          >
            <h2>Shipping address</h2>
            {!customer && <p className="checkout-account-prompt">Checking out as a guest. <Link href={`/account/login?next=${encodeURIComponent(`${buyNow ? `/checkout?buyNow=${buyNow}&quantity=${buyNowQuantity}&intent=${encodeURIComponent(intent)}` : "/checkout"}${attemptId ? `&attempt=${attemptId}` : ""}`)}`}>Sign in</Link> is optional.</p>}
            {addresses.length > 0 && <label>Saved address<select defaultValue="" onChange={(event) => { const address = addresses.find((item) => item.id === Number(event.target.value)); if (address) setForm((current) => ({ ...current, name: address.name, phone: address.phone, address: address.address })); }}><option value="">Choose an address</option>{addresses.map((address) => <option value={address.id} key={address.id}>{address.label} — {address.address}</option>)}</select></label>}
            <div className="checkout-fields">
              <label className="checkout-field-wide">
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
                Email address
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
                Phone number
                <input
                  name="phone"
                  required
                  type="tel"
                  minLength="7"
                  maxLength="30"
                  pattern="(?:[0-9]|\+|\(|\)|\.|\s|-)+"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label className="checkout-field-wide">
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
                  placeholder="Street, building, area, city"
                />
              </label>
            </div>
            <fieldset className="payment-method">
              <legend>Payment method</legend>
              <label className="payment-option">
                <input type="radio" name="paymentMethod" value="cod" defaultChecked />
                <span className="payment-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 7.5h16v11H4zM4 10h16M7 7.5V5h10v2.5M8 14h3" />
                    <circle cx="16.5" cy="14.5" r="1.5" />
                  </svg>
                </span>
                <span>
                  <strong>Cash on Delivery</strong>
                  <small>Pay when your order arrives</small>
                </span>
                <span className="payment-code">COD</span>
              </label>
            </fieldset>
            <button className="button" disabled={busy || navigating || buyNowFailed || !initialized || cart.items.some((item) => !item.available || item.quantity > item.stock) || (!buyNow && (shared.pending || shared.unresolved))}>
              {busy
                ? "Placing order…"
                : `Place order · ${money(cart.totalFils)}`}
            </button>
          </form>
          <aside className="summary" tabIndex="-1">
            <h2>Order summary</h2>
            {cart.items.map((item) => (
              <div className="checkout-summary-item" key={item.productId}>
                <ProductImage src={item.imageUrl} alt="" className="checkout-summary-image" />
                <span>
                  <strong>{item.productName}</strong>
                  <small>SKU: {item.sku} · Qty: {item.quantity}</small>
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

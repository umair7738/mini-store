"use client";

import { apiFetch } from "../../../../lib/apiFetch";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "../../components/CartProvider";
import { money } from "../../../../lib/money";
import { usePending } from "../../../usePending";
import { notify } from "../../../Toast";

export default function AddToCart({ product }) {
  const router = useRouter();
  const { store } = useCart();
  const [busy, run] = usePending();
  const [navigating, setNavigating] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const totalFils = product.priceFils * quantity;
  async function add(event) {
    event.preventDefault();
    setMessage("");
    try {
      if (event.nativeEvent.submitter?.value === "buy") {
        const response = await apiFetch("/api/checkout/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, quantity }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not start Buy Now checkout");
        setNavigating(true);
        router.push(`/checkout?buyNow=${encodeURIComponent(product.slug)}&quantity=${quantity}&attempt=${encodeURIComponent(data.attemptId)}&intent=${encodeURIComponent(data.intent)}`);
        return;
      }
      await store.add(product.id, quantity);
      setMessage("Added to cart.");
      notify("Added to cart");
    } catch (error) { setNavigating(false); notify(error.message, "error"); }
  }
  return <form onSubmit={(event) => { event.preventDefault(); if (!navigating) run(() => add(event)); }} className="purchase-form">
    <p className="product-price-line"><span>Price</span> {money(product.priceFils)}</p>
    <p className="product-stock-meta"><strong>SKU:</strong> {product.sku} · {product.stock > 0 ? "In stock" : "Out of stock"}</p>
    <div className="purchase-quantity"><span className="purchase-label">Quantity</span><div className="cart-quantity" role="group" aria-label="Quantity">
      <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button><span aria-live="polite">{quantity}</span>
      <button type="button" aria-label="Increase quantity" disabled={quantity >= Math.min(20, product.stock)} onClick={() => setQuantity((q) => Math.min(Math.min(20, product.stock), q + 1))}>+</button>
    </div></div>
    <div className="purchase-total"><span>Total</span><strong>{money(totalFils)}</strong></div>
    <div className="purchase-actions">
      <button className="button" disabled={!product.stock || busy || navigating}>Add to cart</button>
      <button className="button secondary" type="submit" name="action" value="buy" disabled={!product.stock || busy || navigating}>Buy now</button>
    </div>
    {message && <p role="status">{message} <Link href="/cart">View cart →</Link></p>}
  </form>;
}

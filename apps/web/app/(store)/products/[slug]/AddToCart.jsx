"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "../../../../lib/money";
import { notify } from "../../../Toast";

export default function AddToCart({ product }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const totalFils = product.priceFils * quantity;
  async function add(event) {
    event.preventDefault();
    setMessage("");
    if (event.nativeEvent.submitter?.value === "buy") {
      router.push(`/checkout?buyNow=${encodeURIComponent(product.slug)}&quantity=${quantity}`);
      return;
    }
    try {
      const response = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, quantity }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not add product");
      setMessage("Added to cart.");
      window.dispatchEvent(new Event("cart-updated"));
      notify("Added to cart");
    } catch (error) { notify(error.message, "error"); }
  }
  return <form onSubmit={add} className="purchase-form">
    <p className="product-price-line"><span>Price</span> {money(product.priceFils)}</p>
    <p className="product-stock-meta"><strong>SKU:</strong> {product.sku} · {product.stock > 0 ? "In stock" : "Out of stock"}</p>
    <div className="purchase-quantity"><span className="purchase-label">Quantity</span><div className="cart-quantity" role="group" aria-label="Quantity">
      <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button><span aria-live="polite">{quantity}</span>
      <button type="button" aria-label="Increase quantity" disabled={quantity >= Math.min(20, product.stock)} onClick={() => setQuantity((q) => Math.min(Math.min(20, product.stock), q + 1))}>+</button>
    </div></div>
    <div className="purchase-total"><span>Total</span><strong>{money(totalFils)}</strong></div>
    <div className="purchase-actions">
      <button className="button" disabled={!product.stock}>Add to cart</button>
      <button className="button secondary" type="submit" name="action" value="buy" disabled={!product.stock}>Buy now</button>
    </div>
    {message && <p role="status">{message} <Link href="/cart">View cart →</Link></p>}
  </form>;
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { money } from "../../../../lib/money";
import { focusField, invalidForm, notify } from "../../../Toast";

export default function AddToCart({ variants }) {
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const selected = variants.find((variant) => variant.id === Number(variantId));
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage("");
    try {
      const response = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: Number(variantId),
          quantity: Number(quantity),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage("Added to cart.");
        notify("Added to cart");
      } else {
        notify(data.message, "error");
        if (data.code === "INSUFFICIENT_STOCK") focusField(form, "quantity");
      }
    } catch {
      notify("Cart is unavailable. Please try again.", "error");
    }
  }
  return (
    <form onSubmit={add} onInvalid={invalidForm} className="purchase-form">
      <label>
        Finish / size
        <select
          name="variantId"
          required
          value={variantId}
          onChange={(event) => setVariantId(event.target.value)}
        >
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label} — {money(variant.priceFils)}{" "}
              {variant.stock ? "" : "(out of stock)"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <input
          name="quantity"
          type="number"
          min="1"
          max={Math.min(99, selected?.stock || 0)}
          step="1"
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <button className="button" disabled={!selected?.stock}>
        Add to cart
      </button>
      {message && (
        <p role="status">
          {message}{" "}
          {message === "Added to cart." && (
            <Link href="/cart">View cart →</Link>
          )}
        </p>
      )}
    </form>
  );
}

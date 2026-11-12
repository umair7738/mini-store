"use client";

import { apiFetch } from "../../../lib/apiFetch";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "./CartProvider";
import { money } from "../../../lib/money";
import { notify } from "../../Toast";
import ProductImage from "./ProductImage";
import StockBadge from "./StockBadge";

export default function ProductCard({ product }) {
  const { store } = useCart();
  const [busy, setBusy] = useState(false);
  const stock = product.stock;

  async function addToCart() {
    if (!product.stock || busy) return;
    setBusy(true);
    try {
      await store.add(product.id, 1);
      notify("Added to cart");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="product-card">
      <Link href={`/products/${product.slug}`} className="product-card-image">
        <ProductImage src={product.imageUrl} alt={product.name} />
      </Link>
      <div className="card-details">
        <div>
          <Link href={`/products/${product.slug}`}><h3>{product.name}</h3></Link>
          <StockBadge stock={stock} />
        </div>
        <strong>{money(product.priceFils)}</strong>
      </div>
      <div className="product-card-actions">
        <Link className="text-button" href={`/products/${product.slug}`}>View details</Link>
        <button className="button small" type="button" disabled={!product.stock || busy} onClick={addToCart}>
          {busy ? "Adding…" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}

"use client";

import { apiFetch } from "../../../lib/apiFetch";

import Link from "next/link";
import { useCart } from "./CartProvider";

export default function StoreHeader() {
  const { cart } = useCart();
  const count = cart?.items.reduce((total, item) => total + item.quantity, 0) || 0;

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Danube Milano home">
        DANUBE <span>MILANO</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/">Home</Link>
        <Link href="/shop">Shop</Link>
        <Link href="/orders">My Orders</Link>
        <Link href="/account">Account</Link>
        <Link href="/cart" className="cart-link">
          Cart <span className="cart-badge" aria-label={`${count} items in cart`}>{count}</span>
        </Link>
      </nav>
    </header>
  );
}

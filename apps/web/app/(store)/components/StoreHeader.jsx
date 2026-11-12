"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function StoreHeader() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/cart")
        .then((response) => (response.ok ? response.json() : null))
        .then((cart) => {
          if (!cancelled && cart) {
            setCount(cart.items.reduce((total, item) => total + item.quantity, 0));
          }
        })
        .catch(() => {});
    load();
    window.addEventListener("cart-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("cart-updated", load);
    };
  }, []);

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

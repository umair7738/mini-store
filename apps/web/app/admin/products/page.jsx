"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";
import { useAdmin } from "../AdminShell";

export default function AdminProductsPage() {
  const { request } = useAdmin();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    request("/api/admin/products").then((data) => setProducts(data.products)).catch((e) => setError(e.message));
  }, [request, reload]);
  async function archive(product) {
    if (!window.confirm(`Archive ${product.name}?`)) return;
    try { await request(`/api/admin/products/${product.id}`, { method: "DELETE" }); setReload((n) => n + 1); }
    catch (e) { setError(e.message); }
  }
  const filtered = products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="admin-page product-management">
    <div className="admin-page-heading"><div><p className="eyebrow">CATALOGUE</p><h1>Products</h1><p>Manage products, prices, stock, and storefront descriptions.</p></div><Link className="button" href="/admin/products/new">Add product</Link></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="product-table-toolbar"><label>Search products<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or SKU" /></label><span>{filtered.length} products</span></div>
    <div className="product-admin-list">
      {filtered.map((product) => <article className="product-admin-row" key={product.id}>
        {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="admin-product-thumb fallback" />}
        <div className="product-admin-info"><strong>{product.name}</strong><small>{product.sku} · {product.stock} in stock</small></div>
        <strong>{money(product.priceFils)}</strong>
        <span className={`status-pill ${product.isActive ? "success" : "cancelled"}`}>{product.isActive ? "Active" : "Archived"}</span>
        <div className="product-admin-actions"><Link href={`/admin/products/${product.id}/edit`}>Edit</Link><button type="button" className="text-button" onClick={() => archive(product)}>Archive</button></div>
      </article>)}
      {!filtered.length && <p className="admin-empty">No products found.</p>}
    </div>
  </section>;
}

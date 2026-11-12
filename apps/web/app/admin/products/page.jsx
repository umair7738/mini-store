"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";
import { useAdmin } from "../AdminShell";
import { usePending } from "../../usePending";
import Pagination from "../Pagination";

export default function AdminProductsPage() {
  const { request } = useAdmin();
  const [busy, run] = usePending();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => request(`/api/admin/products?${new URLSearchParams({ page, search: query })}`).then((data) => {
      if (!cancelled) { setProducts(data.products); setTotal(data.total); setPage(data.page); setError(""); }
    }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); }), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [request, reload, page, query]);
  async function toggleVisibility(product) {
    try { await request(`/api/admin/products/${product.id}/visibility`, { method: "PATCH", body: JSON.stringify({ isActive: !product.isActive }) }); setError(""); setReload((n) => n + 1); }
    catch (e) { setError(e.message); }
  }
  async function remove(product) {
    if (!window.confirm(`Permanently delete ${product.name}? This cannot be undone.`)) return;
    try { await request(`/api/admin/products/${product.id}/permanent`, { method: "DELETE" }); setReload((n) => n + 1); }
    catch (e) { setError(e.message); }
  }
  return <section className="admin-page product-management">
    <div className="admin-page-heading"><div><p className="eyebrow">CATALOGUE</p><h1>Products</h1><p>Manage products, prices, stock, and storefront descriptions.</p></div><Link className="button" href="/admin/products/new">Add product</Link></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="product-table-toolbar"><label>Search products<input type="search" maxLength="254" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Name or SKU" /></label><span>{total} products</span></div>
    <div className="product-admin-list">
      {loading ? <p className="admin-empty" role="status">Loading products…</p> : products.map((product) => <article className="product-admin-row" key={product.id}>
        {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="admin-product-thumb fallback" />}
        <div className="product-admin-info"><strong>{product.name}</strong><small>{product.sku} · {product.stock} in stock</small></div>
        <strong>{money(product.priceFils)}</strong>
        <span className={`status-pill ${product.isActive ? "success" : "cancelled"}`}>{product.isActive ? "Active" : "Archived"}</span>
        <div className="product-admin-actions"><Link className="product-icon-action" href={`/admin/products/${product.id}/edit`} aria-label={`Edit ${product.name}`} title="Edit product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 3.8 3.8-.8L18.5 8a2.1 2.1 0 0 0-3-3L4 16.5ZM14.5 6.5l3 3" /></svg></Link><button type="button" className="cart-delete product-icon-action" aria-label={`${product.isActive ? "Deactivate" : "Activate"} ${product.name}`} title={product.isActive ? "Deactivate product" : "Activate product"} disabled={busy} onClick={() => run(() => toggleVisibility(product))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.5" />{!product.isActive && <path d="M4 4l16 16" />}</svg></button>{product.canDelete && <button type="button" className="cart-delete product-delete" aria-label={`Delete ${product.name}`} title="Delete permanently" disabled={busy} onClick={() => run(() => remove(product))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v5m4-5v5" /></svg></button>}</div>
      </article>)}
      {!loading && !products.length && <p className="admin-empty">{error ? "Products could not be loaded." : "No products found."}</p>}
    </div>
    {!loading && total > 0 && <Pagination page={page} total={total} pageSize={10} onPageChange={setPage} />}
  </section>;
}

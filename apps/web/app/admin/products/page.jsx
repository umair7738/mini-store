"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "../../../lib/money";
import { focusField, invalidForm, notify } from "../../Toast";
import { useAdmin } from "../AdminShell";

const blankVariant = {
  variantKey: "",
  label: "",
  sku: "",
  price: "",
  stock: 0,
  finish: "",
  dimensions: "",
};

function variantKey(value) {
  return `${value.label} ${value.finish} ${value.dimensions}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function productSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function variantSku(value) {
  return `DM-${variantKey(value)}`.toUpperCase().slice(0, 64);
}

function variantValue(variant) {
  const attributes = variant.attributes || {};
  return {
    variantKey: variant.variantKey,
    label: variant.label,
    sku: variant.sku,
    price: (variant.priceFils / 100).toFixed(2),
    stock: variant.stock,
    finish: attributes.finish || attributes.color || "",
    dimensions:
      attributes.dimensions ||
      attributes.size ||
      (attributes.widthCm ? `${attributes.widthCm} cm` : ""),
  };
}

function VariantFields({ value, onChange }) {
  const field = (key, next) => onChange({ ...value, [key]: next });
  return (
    <div className="field-grid">
      <label>
        Variant name
        <input
          name="label"
          required
          maxLength="100"
          value={value.label}
          onChange={(event) => field("label", event.target.value)}
          placeholder="Matte Black · 60 cm"
        />
      </label>
      <label>
        Finish / colour
        <input
          name="finish"
          maxLength="100"
          value={value.finish}
          onChange={(event) => field("finish", event.target.value)}
          placeholder="Matte Black"
        />
      </label>
      <label>
        Size / dimensions
        <input
          name="dimensions"
          maxLength="100"
          value={value.dimensions}
          onChange={(event) => field("dimensions", event.target.value)}
          placeholder="60 cm"
        />
      </label>
      <label>
        Price (AED)
        <input
          name="price"
          required
          type="number"
          min="0.01"
          max="42949672.95"
          step="0.01"
          value={value.price}
          onChange={(event) => field("price", event.target.value)}
        />
      </label>
      <label>
        Stock
        <input
          name="stock"
          required
          type="number"
          min="0"
          max="4294967295"
          step="1"
          value={value.stock}
          onChange={(event) => field("stock", event.target.value)}
        />
      </label>
      <details className="variant-internal">
        <summary>Internal product details</summary>
        <label>
          SKU
          <input
            name="sku"
            maxLength="64"
            pattern="[A-Z0-9-]+"
            title="Use uppercase letters, numbers, and hyphens"
            value={value.sku}
            onChange={(event) => field("sku", event.target.value)}
            placeholder={`Generated: ${variantSku(value) || "DM-VARIANT"}`}
          />
          <small>Leave blank to generate a stock code from the variant name.</small>
        </label>
      </details>
    </div>
  );
}

function variantPayload(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value.price))) {
    const error = new Error("Price must have at most two decimal places");
    error.field = "price";
    throw error;
  }
  const [whole, fraction = ""] = String(value.price).split(".");
  const generatedKey = value.variantKey || variantKey(value);
  if (!generatedKey) {
    const error = new Error("Enter a variant name");
    error.field = "label";
    throw error;
  }
  const attributes = {};
  if (value.finish.trim()) attributes.finish = value.finish.trim();
  if (value.dimensions.trim()) attributes.dimensions = value.dimensions.trim();
  return {
    variantKey: generatedKey,
    label: value.label,
    sku: value.sku || variantSku(value),
    priceFils: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
    stock: Number(value.stock),
    attributes,
  };
}

function ExistingVariant({ variant, request, refresh, report }) {
  const [value, setValue] = useState(() => variantValue(variant));
  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request(`/api/admin/products/variants/${variant.id}`, {
        method: "PUT",
        body: JSON.stringify(variantPayload(value)),
      });
      await refresh();
      report("Variant updated");
    } catch (error) {
      report(error.message, true, form, error.field);
    }
  }
  async function archive() {
    if (!confirm(`Archive ${variant.label}?`)) return;
    try {
      await request(`/api/admin/products/variants/${variant.id}`, {
        method: "DELETE",
      });
      await refresh();
      report("Variant archived");
    } catch (error) {
      report(error.message, true);
    }
  }
  return (
    <details className="variant-box">
      <summary className="row-between">
        <strong>{variant.label}</strong>
        <span>{variant.isActive
          ? `${money(variant.priceFils)} · ${variant.stock} in stock`
          : "Archived"}</span>
      </summary>
      {variant.isActive && (
        <form onSubmit={save} onInvalid={invalidForm}>
          <VariantFields value={value} onChange={setValue} />
          <div className="button-row">
            <button className="button small">Save variant</button>
            <button type="button" className="text-button" onClick={archive}>
              Archive variant
            </button>
          </div>
        </form>
      )}
      {!variant.isActive && <p className="fine-print">SKU {variant.sku} is archived and kept for order history.</p>}
    </details>
  );
}

export default function AdminProductsPage() {
  const { request } = useAdmin();
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [newProduct, setNewProduct] = useState({
    name: "",
    slug: "",
    description: "",
  });
  const [initialVariant, setInitialVariant] = useState(blankVariant);
  const [newVariant, setNewVariant] = useState(blankVariant);
  const [editProduct, setEditProduct] = useState({ name: "", description: "" });
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const selected = products.find((product) => product.id === selectedId);
  const visibleProducts = products.filter((product) => {
    if (filter === "active" && !product.isActive) return false;
    if (filter === "archived" && product.isActive) return false;
    return `${product.name} ${product.slug} ${product.variants.map((variant) => variant.sku).join(" ")}`
      .toLowerCase().includes(query.toLowerCase().trim());
  });

  function report(message, error = false, form, field) {
    setNotice(message);
    setIsError(error);
    if (message) notify(message, error ? "error" : "success");
    if (error && form) focusField(form, field);
  }
  async function refresh() {
    const data = await request("/api/admin/products");
    setProducts(data.products);
  }

  useEffect(() => {
    setLoading(true);
    request("/api/admin/products")
      .then((data) => { setProducts(data.products); setLoadError(""); })
      .catch((error) => setLoadError(error.message))
      .finally(() => setLoading(false));
  }, [request, reload]);

  async function createProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const created = await request("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          ...newProduct,
          slug: newProduct.slug || productSlug(newProduct.name),
          variants: [variantPayload(initialVariant)],
        }),
      });
      setNewProduct({ name: "", slug: "", description: "" });
      setInitialVariant(blankVariant);
      await refresh();
      setSelectedId(created.id);
      setEditProduct({ name: newProduct.name, description: newProduct.description });
      form.closest("details").open = false;
      report("Product created");
    } catch (error) {
      report(error.message, true, form, error.field);
    }
  }
  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request(`/api/admin/products/${selectedId}`, {
        method: "PUT",
        body: JSON.stringify(editProduct),
      });
      await refresh();
      report("Product updated");
    } catch (error) {
      report(error.message, true, form, error.field);
    }
  }
  async function archiveProduct() {
    if (!confirm(`Archive ${selected.name}?`)) return;
    try {
      await request(`/api/admin/products/${selectedId}`, { method: "DELETE" });
      await refresh();
      setSelectedId(null);
      report("Product archived");
    } catch (error) {
      report(error.message, true);
    }
  }
  async function addVariant(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await request(`/api/admin/products/${selectedId}/variants`, {
        method: "POST",
        body: JSON.stringify(variantPayload(newVariant)),
      });
      setNewVariant(blankVariant);
      await refresh();
      report("Variant added");
    } catch (error) {
      report(error.message, true, form, error.field);
    }
  }
  function select(product) {
    setSelectedId(product.id);
    setEditProduct({ name: product.name, description: product.description });
    report("");
  }

  return (
    <section className="admin-page">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">CATALOGUE</p>
          <h1>Products</h1>
          <p>Manage product families, variants, prices, and inventory.</p>
        </div>
        <button className="button small" type="button" onClick={() => {
          const details = document.getElementById("create-product");
          details.open = true;
          details.scrollIntoView({ behavior: "smooth", block: "start" });
          details.querySelector('input[name="name"]').focus({ preventScroll: true });
        }}>Add product</button>
      </div>
      {loadError && <p className="notice error" role="alert">{loadError} <button className="text-button" onClick={() => setReload(reload + 1)}>Retry</button></p>}
      {notice && (
        <p className={`notice ${isError ? "error" : ""}`} role="status">
          {notice}
        </p>
      )}
      <div className="admin-grid">
        <aside className="admin-list" aria-label="Product list">
          <div className="admin-list-header">
            <h2>Catalogue</h2>
            <span>{products.filter((product) => product.isActive).length} active</span>
          </div>
          <label className="admin-search-label">Search name, slug, or SKU
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} placeholder="Find a product" />
          </label>
          <label className="admin-filter-label">Show
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setSelectedId(null); }}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All products</option>
            </select>
          </label>
          <div className="admin-list-items">
          {loading && <p className="admin-empty" role="status">Loading catalogue…</p>}
          {!loading && visibleProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              className={selectedId === product.id ? "selected" : ""}
              aria-pressed={selectedId === product.id}
              onClick={() => select(product)}
            >
              <strong>{product.name}</strong>
              <small>
                {product.slug} · {product.isActive ? "Active" : "Archived"}
              </small>
            </button>
          ))}
          {!loading && !visibleProducts.length && !loadError && <p className="admin-empty">No matching products.</p>}
          </div>
        </aside>
        <div className="admin-main">
          <details className="admin-create" id="create-product">
            <summary>Create a product family <span>＋</span></summary>
          <form
            className="form-panel"
            onSubmit={createProduct}
            onInvalid={invalidForm}
          >
            <h2>Create product</h2>
            <div className="field-grid">
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength="120"
                  value={newProduct.name}
                  onChange={(event) =>
                    setNewProduct({ ...newProduct, name: event.target.value })
                  }
                />
              </label>
              <details className="variant-internal">
                <summary>Storefront URL (optional)</summary>
                <label>
                URL ending
                <input
                  name="slug"
                  maxLength="120"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Use lowercase letters, numbers, and hyphens"
                  value={newProduct.slug}
                  onChange={(event) =>
                    setNewProduct({ ...newProduct, slug: event.target.value })
                  }
                  placeholder={`Generated: ${productSlug(newProduct.name) || "product-name"}`}
                />
                <small>Leave blank to create this automatically from the product name.</small>
                </label>
              </details>
            </div>
            <label>
              Description
              <textarea
                name="description"
                required
                maxLength="5000"
                value={newProduct.description}
                onChange={(event) =>
                  setNewProduct({
                    ...newProduct,
                    description: event.target.value,
                  })
                }
              />
            </label>
            <h3>First variant</h3>
            <VariantFields
              value={initialVariant}
              onChange={setInitialVariant}
            />
            <button className="button small">Create product</button>
          </form>
          </details>
          {!selected && <div className="admin-empty-panel">Select a product to edit its details and variants, or create a new family above.</div>}
          {selected && (
            <div className="form-panel">
              <div className="row-between">
                <h2>{selected.name}</h2>
                <span className={`status-pill ${selected.isActive ? "success" : "muted"}`}>{selected.isActive ? "Active" : "Archived"}</span>
              </div>
              <p className="fine-print">
                URL: /products/{selected.slug} · Slugs stay fixed after
                creation.
              </p>
              {selected.isActive && <p><Link href={`/products/${selected.slug}`} target="_blank" rel="noopener noreferrer">View product ↗</Link></p>}
              {selected.isActive && (
                <>
                  <form onSubmit={saveProduct} onInvalid={invalidForm}>
                    <label>
                      Name
                      <input
                        name="name"
                        required
                        maxLength="120"
                        value={editProduct.name}
                        onChange={(event) =>
                          setEditProduct({
                            ...editProduct,
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        name="description"
                        required
                        maxLength="5000"
                        value={editProduct.description}
                        onChange={(event) =>
                          setEditProduct({
                            ...editProduct,
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="button-row">
                      <button className="button small">Save product</button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={archiveProduct}
                      >
                        Archive product
                      </button>
                    </div>
                  </form>
                  <h3>Variants</h3>
                  {selected.variants.map((variant) => (
                    <ExistingVariant
                      key={variant.id}
                      variant={variant}
                      request={request}
                      refresh={refresh}
                      report={report}
                    />
                  ))}
                  <form
                    onSubmit={addVariant}
                    onInvalid={invalidForm}
                    className="variant-box"
                  >
                    <h3>Add variant</h3>
                    <VariantFields
                      value={newVariant}
                      onChange={setNewVariant}
                    />
                    <button className="button small">Add variant</button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

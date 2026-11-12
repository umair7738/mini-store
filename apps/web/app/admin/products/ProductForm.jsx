"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { focusField, invalidForm, notify } from "../../Toast";
import { usePending } from "../../usePending";
import { useAdmin } from "../AdminShell";

function RichTextEditor({ value, onChange }) {
  const editor = useRef(null);
  const initialValue = useRef(value);
  function command(action, argument) {
    editor.current?.focus();
    document.execCommand(action, false, argument);
    onChange(editor.current?.innerHTML || "");
  }
  return <div className="rich-editor">
    <div className="rich-editor-toolbar" aria-label="Description formatting">
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("formatBlock", "<p>")}>Paragraph</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("formatBlock", "<h3>")}>Heading</button>
      <button type="button" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => command("bold")}><strong>B</strong></button>
      <button type="button" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => command("italic")}><em>I</em></button>
      <button type="button" aria-label="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => command("insertUnorderedList")}>List</button>
      <button type="button" aria-label="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => command("insertOrderedList")}>1. List</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const url = window.prompt("Link address (https://…)"); if (url) command("createLink", url); }}>Link</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => command("removeFormat")}>Clear format</button>
    </div>
    <div ref={editor} className="rich-editor-content" contentEditable suppressContentEditableWarning role="textbox" aria-label="Product description" aria-multiline="true" onInput={(event) => onChange(event.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: initialValue.current }} />
  </div>;
}

export default function ProductForm({ product = null }) {
  const { request } = useAdmin();
  const [busy, run] = usePending();
  const router = useRouter();
  const [value, setValue] = useState(() => product ? { ...product, images: product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [], price: (product.priceFils / 100).toFixed(2), stock: String(product.stock) } : { name: "", slug: "", description: "<p></p>", images: [], sku: "", price: "", stock: "", isActive: true });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  async function uploadImages(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;
    if (value.images.length + files.length > 8) { notify("Choose up to 8 product images", "error"); return; }
    const body = new FormData();
    files.forEach((file) => body.append("images", file));
    setUploading(true);
    try {
      const result = await request("/api/admin/uploads/images", { method: "POST", body });
      setValue((current) => ({ ...current, images: [...current.images, ...result.images] }));
    } catch (problem) { notify(problem.message, "error"); }
    finally { setUploading(false); }
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      setError("");
      const payload = { name: value.name, description: value.description, sku: value.sku, images: value.images, isActive: value.isActive, priceFils: Math.round(Number(value.price) * 100), stock: Number(value.stock), slug: value.slug || value.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") };
      if (product) await request(`/api/admin/products/${product.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await request("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
      notify(product ? "Product updated" : "Product created");
      router.push("/admin/products");
      router.refresh();
    } catch (problem) {
      setError(problem.message);
      notify(problem.message, "error");
      focusField(form, problem.field);
    }
  }
  return <form className="form-panel product-form" onSubmit={(event) => { event.preventDefault(); run(() => submit(event)); }} onInvalid={invalidForm}>
    <header className="product-editor-heading"><div><h1>{product ? "Edit product" : "Add a product"}</h1><p>Manage the details customers see in your store.</p></div><label className="product-status-toggle"><input type="checkbox" checked={value.isActive} onChange={(e) => setValue({ ...value, isActive: e.target.checked })} /><span className="toggle-track" aria-hidden="true" /><span>{value.isActive ? "Active" : "Hidden"}</span></label></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="product-form-grid">
      <div className="product-form-fields">
        <label>Product name <span className="required-star" aria-hidden="true">*</span><input name="name" required minLength="2" maxLength="120" value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} /></label>
        <label>Product URL name<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength="120" value={value.slug} onChange={(e) => setValue({ ...value, slug: e.target.value })} placeholder="Created from product name" /><small>Used in the product web address.</small></label>
        <label>Product description<RichTextEditor value={value.description} onChange={(description) => setValue({ ...value, description })} /></label>
        <section className="image-upload-panel"><div className="image-upload-heading"><div><strong>Product images</strong><small>Upload up to 8 PNG, JPEG, or WebP images. First image is the main photo.</small></div><label className="button secondary small">{uploading ? "Uploading…" : "Upload images"}<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={uploading || busy || value.images.length >= 8} onChange={uploadImages} /></label></div>{value.images.length > 0 && <div className="product-image-list">{value.images.map((image, index) => <div className="product-image-tile" key={image}><img src={image} alt={`Product image ${index + 1}`} /><button type="button" aria-label={`Remove image ${index + 1}`} onClick={() => setValue({ ...value, images: value.images.filter((_, itemIndex) => itemIndex !== index) })}>×</button>{index === 0 && <small>Main image</small>}</div>)}</div>}</section>
      </div>
      <aside className="product-inventory-panel">
        <h2>Price & inventory</h2>
        <label>SKU <span className="required-star" aria-hidden="true">*</span><input name="sku" required maxLength="64" pattern="[A-Z0-9-]+" value={value.sku} onChange={(e) => setValue({ ...value, sku: e.target.value.toUpperCase() })} placeholder="DM-PRODUCT-001" /><small>Unique stock code for this product.</small></label>
        <label>Price (AED) <span className="required-star" aria-hidden="true">*</span><input name="price" required type="number" min="0.01" max="42949672.95" step="0.01" value={value.price} onChange={(e) => setValue({ ...value, price: e.target.value })} /><small>Enter at least AED 0.01.</small></label>
        <label>Stock quantity <span className="required-star" aria-hidden="true">*</span><input name="stock" required type="number" min="0" max="4294967295" step="1" value={value.stock} onChange={(e) => setValue({ ...value, stock: e.target.value })} /><small>Enter a whole number; use 0 for out of stock.</small></label>
      </aside>
    </div>
    <div className="button-row"><button className="button" disabled={uploading || busy}>{product ? "Save product" : "Create product"}</button><button type="button" className="button secondary" onClick={() => router.push("/admin/products")}>Cancel</button></div>
  </form>;
}

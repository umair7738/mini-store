"use client";

import { useEffect, useState } from "react";
import ProductForm from "../../ProductForm";
import { useAdmin } from "../../../AdminShell";

export default function EditProductPage({ params }) {
  const { request } = useAdmin();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState("");
  const [id, setId] = useState(null);

  useEffect(() => { Promise.resolve(params).then(({ id: productId }) => setId(productId)); }, [params]);
  useEffect(() => {
    if (!id) return;
    request("/api/admin/products").then((data) => {
      const found = data.products.find((item) => String(item.id) === String(id));
      if (!found) throw new Error("Product not found");
      setProduct(found);
    }).catch((problem) => setError(problem.message));
  }, [id, request]);

  if (error) return <section className="admin-page"><div className="notice error" role="alert">{error}</div></section>;
  if (!product) return <section className="admin-page"><p role="status">Loading product…</p></section>;
  return <section className="admin-page"><ProductForm product={product} /></section>;
}

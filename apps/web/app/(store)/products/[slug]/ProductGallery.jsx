"use client";

import { useState } from "react";
import ProductImage from "../../components/ProductImage";

export default function ProductGallery({ images, name }) {
  const [selected, setSelected] = useState(0);
  const photos = images?.length ? images : [null];
  return <div className="product-gallery">
    <ProductImage src={photos[selected]} alt={name} />
    {photos.length > 1 && <div className="product-gallery-thumbs" aria-label="Product photos">
      {photos.map((src, index) => <button type="button" key={src} className={selected === index ? "selected" : ""} aria-label={`Show product photo ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)}><img src={src} alt="" /></button>)}
    </div>}
  </div>;
}

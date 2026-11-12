"use client";

import { useState } from "react";

export default function ProductImage({ src, alt, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`product-image-fallback ${className}`} aria-label={`${alt} image unavailable`} />;
  }
  return (
    <img
      className={`product-image ${className}`}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

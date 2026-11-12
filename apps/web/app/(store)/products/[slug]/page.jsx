import { notFound } from "next/navigation";
import Link from "next/link";
import { getProduct } from "../../../../lib/products";
import AddToCart from "./AddToCart";
import ProductGallery from "./ProductGallery";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/products/${slug}` },
  };
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const structured = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    offers: [{
      "@type": "Offer",
      sku: product.sku,
      priceCurrency: "AED",
      price: (product.priceFils / 100).toFixed(2),
      availability:
        product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: `${site}/products/${slug}`,
    }],
  };
  return (
    <section className="section product-detail">
      <div className="detail-art">
        <ProductGallery images={product.images} name={product.name} />
      </div>
      <div className="detail-copy">
        <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/shop">Shop</Link><span>/</span><span>{product.name}</span></nav>
        <p className="eyebrow">BATHROOM ESSENTIALS</p>
        <h1>{product.name}</h1>
        <div className="lead product-description" dangerouslySetInnerHTML={{ __html: product.description }} />
        <AddToCart product={product} />
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structured).replace(/</g, "\\u003c"),
        }}
      />
    </section>
  );
}

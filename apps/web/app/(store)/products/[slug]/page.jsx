import { notFound } from "next/navigation";
import Link from "next/link";
import { getProduct } from "../../../../lib/products";
import { money } from "../../../../lib/money";
import AddToCart from "./AddToCart";

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
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      priceCurrency: "AED",
      price: (v.priceFils / 100).toFixed(2),
      availability:
        v.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      url: `${site}/products/${slug}`,
    })),
  };
  return (
    <section className="section product-detail">
      <div className="detail-art">
        <span>DANUBE MILANO</span>
        <strong>{product.name}</strong>
      </div>
      <div className="detail-copy">
        <Link href="/" className="back-link">
          ← All products
        </Link>
        <p className="eyebrow">BATHROOM ESSENTIALS</p>
        <h1>{product.name}</h1>
        <p className="lead">{product.description}</p>
        <p className="price-line">
          From {money(Math.min(...product.variants.map((v) => v.priceFils)))}
        </p>
        <AddToCart variants={product.variants} />
        <p className="fine-print">
          Prices are calculated again at checkout. Stock is subject to
          availability.
        </p>
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

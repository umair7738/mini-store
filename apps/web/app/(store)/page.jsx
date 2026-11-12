import Link from "next/link";
import { getProducts } from "../../lib/products";
import ProductGrid from "./components/ProductGrid";
import ProductImage from "./components/ProductImage";

export const metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const products = await getProducts();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SANITARY COLLECTION</p>
          <h1>Designed for refined spaces.</h1>
          <p>Quiet forms, dependable materials, and essentials made for everyday living.</p>
          <Link href="/shop" className="button">Shop collection</Link>
        </div>
        <div className="hero-image">
          <ProductImage src={products[0]?.imageUrl} alt={products[0]?.name || "Bathroom product"} />
        </div>
      </section>
      <section id="collection" className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE COLLECTION</p>
            <h2>Considered essentials</h2>
          </div>
          <div className="section-heading-actions">
            <Link href="/shop" className="button secondary collection-link">Browse the full collection</Link>
          </div>
        </div>
        <ProductGrid products={products.slice(0, 3)} />
      </section>
    </>
  );
}

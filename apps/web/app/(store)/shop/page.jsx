import Link from "next/link";
import { getProducts } from "../../../lib/products";
import ProductGrid from "../components/ProductGrid";

export const metadata = { title: "The Collection", alternates: { canonical: "/shop" } };

export default async function ShopPage() {
  const products = await getProducts();
  return (
    <section className="section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><span>Shop</span></nav>
      <div className="section-heading shop-heading">
        <div><p className="eyebrow">THE COLLECTION</p><h1>The Collection</h1></div>
        <p>{products.length} available product{products.length === 1 ? "" : "s"}.</p>
      </div>
      <ProductGrid products={products} />
    </section>
  );
}

import Link from "next/link";
import { getProducts } from "../../lib/products";
import { money } from "../../lib/money";

export const metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const products = await getProducts();
  return (
    <>
      <section className="hero">
        <p className="eyebrow">SANITARY COLLECTION</p>
        <h1>
          Better bathrooms
          <br />
          <em>begin here.</em>
        </h1>
        <p>
          Quiet forms, dependable materials, and essentials made for everyday
          living.
        </p>
        <a href="#collection" className="button">
          Explore collection
        </a>
      </section>
      <section id="collection" className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE COLLECTION</p>
            <h2>Considered essentials</h2>
          </div>
          <p>
            Three product families, selected for a clean and lasting bathroom.
          </p>
        </div>
        <div className="product-grid">
          {products.map((product, index) => (
            <Link
              className="product-card"
              href={`/products/${product.slug}`}
              key={product.id}
            >
              <div className={`product-art art-${index + 1}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{product.name.split(" ").slice(-2).join(" ")}</strong>
              </div>
              <div className="card-details">
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.variants.length} finishes / sizes</p>
                </div>
                <span>
                  From{" "}
                  {money(Math.min(...product.variants.map((v) => v.priceFils)))}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

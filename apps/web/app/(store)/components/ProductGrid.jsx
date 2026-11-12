import ProductCard from "./ProductCard";

export default function ProductGrid({ products }) {
  if (!products.length) return <div className="empty"><p>No products are available right now.</p></div>;
  return <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>;
}

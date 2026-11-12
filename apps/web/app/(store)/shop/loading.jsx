export default function Loading() {
  return <section className="section"><div className="skeleton-heading" /><div className="product-grid">{[1, 2, 3].map((item) => <div className="product-skeleton" key={item} />)}</div></section>;
}

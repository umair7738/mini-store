export default function StockBadge({ stock }) {
  if (!stock) return <span className="stock-badge out">Out of stock</span>;
  if (stock <= 5) return <span className="stock-badge low">Only {stock} left</span>;
  return <span className="stock-badge">In stock</span>;
}

import { getProducts } from "../lib/products";

export default async function sitemap() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const products = await getProducts();
  return [
    { url: base },
    ...products.map((product) => ({ url: `${base}/products/${product.slug}` })),
  ];
}

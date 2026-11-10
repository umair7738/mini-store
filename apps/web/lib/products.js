export async function getProducts() {
  const response = await fetch(
    `${process.env.API_TARGET || "http://127.0.0.1:4000"}/api/products`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("The product catalogue is unavailable");
  return (await response.json()).products;
}

export async function getProduct(slug) {
  const response = await fetch(
    `${process.env.API_TARGET || "http://127.0.0.1:4000"}/api/products/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The product is unavailable");
  return (await response.json()).product;
}

async (page) => {
  const base = "http://localhost:3000";
  const product = await page.evaluate(async () => (await fetch("/api/products/milano-wall-hung-toilet")).json());
  const item = product.product;
  const stockResponse = await page.evaluate(async ({ productId, quantity }) => {
    const response = await fetch("/api/cart/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity }),
    });
    return { status: response.status, body: await response.json() };
  }, { productId: item.id, quantity: item.stock + 1 });
  if (stockResponse.status !== 409 || stockResponse.body.code !== "INSUFFICIENT_STOCK") {
    throw new Error(`expected insufficient stock, got ${JSON.stringify(stockResponse)}`);
  }

  const response = await page.goto(`${base}/products/milano-wall-hung-toilet`);
  if (response?.status() !== 200) throw new Error("product route failed");
  const increment = page.getByRole("button", { name: "Increase quantity" });
  for (let index = 1; index < 20; index += 1) await increment.click();
  if (!(await increment.isDisabled())) throw new Error("quantity limit was not enforced");
  return { status: "passed", insufficientStock: stockResponse.status, quantityLimit: 20 };
}

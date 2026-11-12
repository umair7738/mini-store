async (page) => {
  const routes = [
    "/",
    "/shop",
    "/products/milano-wall-hung-toilet",
    "/cart",
    "/checkout",
    "/checkout/success?order=2",
    "/orders/1",
    "/admin/login",
    "/admin",
    "/admin/products",
    "/admin/products/new",
    "/admin/products/1/edit",
    "/admin/orders",
  ];
  const results = [];
  for (const route of routes) {
    const response = await page.goto(`http://localhost:3000${route}`);
    results.push({ route, status: response?.status() ?? null, finalUrl: new URL(page.url()).pathname });
    if (!response || response.status() >= 500) throw new Error(`${route} returned ${response?.status()}`);
  }
  return { status: "passed", routeCount: results.length, results };
}

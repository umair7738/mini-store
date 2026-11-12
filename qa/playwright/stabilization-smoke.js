async (page) => {
  const base = "http://localhost:3002";
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  await page.goto(`${base}/cart`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remove = page.getByRole("button", { name: /Remove .* from cart/ });
    if (!(await remove.count())) break;
    await remove.first().click();
  }

  await page.goto(`${base}/products/milano-wall-hung-toilet`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: /Cart 1 items in cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByRole("textbox", { name: "Full name" }).fill("Playwright Buyer");
  await page.getByRole("textbox", { name: "Email address" }).fill("playwright@example.com");
  await page.getByRole("textbox", { name: "Phone number" }).fill("+971 50 555 0199");
  await page.getByRole("textbox", { name: "Delivery address" }).fill("Disposable QA address, Dubai");

  const attemptId = new URL(page.url()).searchParams.get("attempt");
  assert(attemptId, "checkout URL did not contain a logical attempt id");
  let aborted = false;
  await page.route("**/api/checkout", async (route) => {
    if (!aborted) {
      aborted = true;
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: /Place order/ }).click();
  await page.getByRole("button", { name: "Resolve previous checkout" }).waitFor({ state: "visible" });
  const firstKey = await page.evaluate(() => JSON.parse(sessionStorage.getItem("mini-checkout-pending-v1")).idempotencyKey);
  await page.reload();
  assert(new URL(page.url()).searchParams.get("attempt") === attemptId, "refresh changed the logical attempt id");
  await page.getByRole("button", { name: "Resolve previous checkout" }).waitFor({ state: "visible" });
  const retryKey = await page.evaluate(() => JSON.parse(sessionStorage.getItem("mini-checkout-pending-v1")).idempotencyKey);
  assert(retryKey === firstKey, "refresh changed the idempotency key");
  await page.getByRole("button", { name: "Resolve previous checkout" }).click();
  await page.waitForURL(/\/orders\//, { timeout: 20000 });
  return { status: "passed", attemptId, stableIdempotencyKey: true, orderUrl: page.url() };
}

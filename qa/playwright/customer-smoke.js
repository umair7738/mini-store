async (page) => {
  const base = "http://localhost:3000";
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const goto = async (route) => {
    const response = await page.goto(`${base}${route}`);
    assert(response?.status() === 200, `${route} returned ${response?.status()}`);
    await page.waitForTimeout(250);
  };

  await goto("/cart");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remove = page.getByRole("button", { name: "Remove" });
    if (!(await remove.count())) break;
    await remove.first().click();
  }

  await goto("/");
  assert(
    (await page.getByRole("heading", { name: "Designed for refined spaces." }).count()) === 1,
    "home heading missing",
  );
  await page.getByRole("link", { name: "Shop collection" }).click();
  await page.getByRole("link", { name: "View details" }).first().click();
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: /Cart 2 items in cart/ }).waitFor({ state: "visible" });
  assert(
    (await page.getByRole("link", { name: /Cart 2 items in cart/ }).count()) === 1,
    "cart badge did not update",
  );

  await goto("/cart");
  const quantity = page.getByRole("spinbutton", { name: /Quantity for/ }).first();
  assert((await quantity.inputValue()) === "2", "cart did not persist quantity");
  await page.reload();
  assert((await page.getByRole("spinbutton", { name: /Quantity for/ }).first().inputValue()) === "2", "cart was not persistent after refresh");
  await page.getByRole("spinbutton", { name: /Quantity for/ }).first().fill("1");
  await page.getByRole("button", { name: "Update" }).first().click();
  await page.getByRole("spinbutton", { name: /Quantity for/ }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Remove" }).first().click();
  await page.getByText("Your cart is empty.").waitFor({ state: "visible" });
  assert((await page.getByText("Your cart is empty.").count()) === 1, "remove did not empty the cart");

  await goto("/products/milano-wall-hung-toilet");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("1");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: /Cart 1 items in cart/ }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: /Cart 1 items in cart/ }).click();
  await page.getByRole("link", { name: "Continue to checkout" }).click();
  await page.getByRole("textbox", { name: "Full name" }).fill("Playwright Buyer");
  await page.getByRole("textbox", { name: "Email" }).fill("playwright@example.com");
  await page.getByRole("textbox", { name: "Phone" }).fill("+971 50 555 0199");
  await page.getByRole("textbox", { name: "Delivery address" }).fill("Disposable QA address, Dubai");
  await page.getByRole("button", { name: /Place order/ }).click();
  await page.waitForURL(/\/checkout\/success\?order=\d+/);
  await page.getByRole("heading", { name: "Order placed successfully." }).waitFor({ state: "visible" });
  assert((await page.getByRole("heading", { name: "Order placed successfully." }).count()) === 1, "checkout did not succeed");
  await page.reload();
  await page.getByRole("heading", { name: "Order placed successfully." }).waitFor({ state: "visible" });
  assert((await page.getByRole("heading", { name: "Order placed successfully." }).count()) === 1, "confirmation did not survive refresh");
  return { status: "passed", confirmation: new URL(page.url()).pathname };
}

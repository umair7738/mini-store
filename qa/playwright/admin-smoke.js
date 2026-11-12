async (page) => {
  const base = "http://localhost:3000";
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.goto(`${base}/admin`);
  if (page.url().endsWith("/admin/login")) throw new Error("Authenticate in the same Playwright session before running admin-smoke.js");
  await page.getByRole("heading", { name: "Today’s store" }).waitFor({ state: "visible" });
  assert((await page.getByRole("heading", { name: "Today’s store" }).count()) === 1, "admin dashboard missing");

  const name = `Phase 4 QA ${Date.now()}`;
  await page.goto(`${base}/admin/products/new`);
  await page.getByRole("textbox", { name: "Product name" }).fill(name);
  await page.getByRole("textbox", { name: "Description" }).fill("Disposable assessment product.");
  await page.getByRole("textbox", { name: "Image URL" }).fill("/images/products/countertop-basin.png");
  await page.getByRole("textbox", { name: "Variant name" }).fill("QA White");
  await page.getByRole("textbox", { name: "Finish / colour" }).fill("Gloss White");
  await page.getByRole("spinbutton", { name: "Price (AED)" }).fill("123.45");
  await page.getByRole("spinbutton", { name: "Stock" }).fill("5");
  await page.getByRole("textbox", { name: /SKU/ }).fill(`DM-P4-${Date.now()}`);
  await page.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(/\/admin\/products\/\d+\/edit/);

  await page.getByRole("spinbutton", { name: "Price (AED)" }).fill("145.67");
  await page.getByRole("spinbutton", { name: "Stock" }).fill("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/admin\/products$/);
  const productButton = page.getByRole("button", { name: new RegExp(name) });
  await productButton.waitFor({ state: "visible" });
  assert((await productButton.count()) === 1, "created product missing from admin list");
  await productButton.click();
  await page.getByRole("button", { name: "Archive product" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive product" }).click();
  await productButton.waitFor({ state: "detached" });
  assert((await page.getByRole("button", { name: new RegExp(name) }).count()) === 0, "archived product still shown in active list");
  return { status: "passed", product: name, archived: true };
}

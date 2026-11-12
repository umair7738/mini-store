# Danube Milano assessment demo

This is a 5–10 minute demo. Use a disposable demo database and never use real customer data.

## Prepare

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev:api
```

In a second terminal:

```powershell
npm run dev:web
```

Create a disposable admin if needed:

```powershell
$env:ADMIN_EMAIL = "demo-admin@example.com"
$env:ADMIN_PASSWORD = "use-a-local-password-at-least-12-characters"
npm run admin:create
Remove-Item Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD
```

Open <http://localhost:3000>.

## Demonstration sequence

1. Explain the two-app structure: Next.js UI, Express API, and MySQL persistence.
2. Open Home and Shop; show the three seeded product families and product images.
3. Open a product, change quantity, and add it to the cart.
4. Open Cart, refresh to show persistence, update the quantity, and remove the item.
5. Open `/admin/login` and sign in.
6. Create a temporary product with an image, rich description, SKU, price, and stock.
7. Edit its price and stock, then return to the storefront and show the change.
8. Archive the temporary product through the confirmation dialog and show that its storefront URL is unavailable.
9. Add a seeded product to the cart again and open Checkout.
10. Submit name, email, phone, and address. Show the protected confirmation page.
11. Refresh the confirmation page; explain that the stored confirmation token prevents a second order.
12. Return to Admin → Orders. Show the customer phone, immutable item snapshot, total, and order status.
13. Explain that stock was deducted inside the checkout transaction and prices were recalculated on the server.

## Negative-path demonstrations

- Enter an invalid price or duplicate SKU in the admin product form; the API rejects it.
- Submit checkout without a phone; browser and API validation reject it.
- Request more than available stock; the API returns `409 INSUFFICIENT_STOCK`.
- Explain that duplicate checkout keys recover the original order while conflicting reuse is rejected.

## Repeatable browser checks

With the same isolated demo server running, use the scripts in [`qa/playwright`](../qa/playwright/README.md). The customer script creates one disposable order; the admin script creates and archives one disposable product.

## What not to claim

This assessment has no payment provider, customer accounts, email delivery, cloud deployment, distributed rate limiter, or production observability. It is ready for assessment demonstration, not a declaration of production readiness.

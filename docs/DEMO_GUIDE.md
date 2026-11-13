# Danube Milano assessment demo

Plan 5–10 minutes for the core demo, with optional account and email steps afterward. Use disposable products, orders, and contact details: checkout deducts stock and admin actions persist changes.

## Prepare

For a fresh machine, follow [Fresh Windows Setup](FRESH_SETUP_WINDOWS.md) first. It covers dependencies, MySQL, separate development/test databases, and local environment files. For an existing setup, start MySQL before running the commands below from the repository root.

The development API requires `mini_store_dev`; automated tests use `mini_store_test`. Use disposable demo records in the development database. Do not point the normal app at the test database.

For this workspace's MySQL ZIP installation, start the database with:

```powershell
npm run db:start
```

This runs `db.ps1` using `%LOCALAPPDATA%\mini-store-mysql\mysql-8.4.13-winx64` and its sibling `data` directory. Wait until MySQL accepts connections on `127.0.0.1:3306` before migrating or starting the API. If MySQL was installed as a Windows service instead, start that service using the setup guide.

```powershell
npm run db:migrate
npm run db:seed
npm run admin:create
```

Seed reruns preserve existing stock and prices, so confirm a demo product has stock. Creating/updating the admin invalidates that admin's existing sessions.

Start the API in one terminal:

```powershell
npm run dev:api
```

Start the web app in a second terminal:

```powershell
npm run dev:web
```

The fallback demo login is `admin@mini-store.local` / `MiniStoreDemo2026!` only when `NODE_ENV=development`, `DB_NAME=mini_store_dev`, and neither `ADMIN_EMAIL` nor `ADMIN_PASSWORD` is set. If those variables are configured, use the configured credentials; the admin password must have at least 12 characters.

Open <http://localhost:3000>. The API defaults to port 4000, and Next.js forwards browser `/api` requests to it. These URLs assume the default environment settings.

For email demonstrations, configure `BREVO_API_KEY`, `EMAIL_FROM`, and optional `EMAIL_FROM_NAME` in `apps/api/.env`, using a sender authorized in Brevo, then restart the API. Use an inbox you control. Guest checkout remains available without email configuration; account registration, verification resend, and order recovery require it. Order-notification delivery failures do not roll back committed orders.

## Demonstration sequence

1. Explain the two-app structure: Next.js UI, Express API, and MySQL persistence.
2. Open Home and Shop; show the three seeded products, images, AED prices, and stock labels.
3. Open an in-stock product, change quantity with the minus/plus controls, and add it to the cart. Quantities are limited to the lower of available stock and 20.
4. Open Cart, refresh to show persistence, change quantity, and wait for "Cart saved" before checkout. Remove an item to demonstrate cart editing.
5. Open `/admin/login` and sign in.
6. Create a temporary product with a unique SKU, positive price, whole-number stock, rich description, and an uploaded image. The editor accepts up to eight PNG, JPEG, or WebP images; the first is the main image.
7. Edit its price and stock, then return to the storefront and show the change. Use a valid URL name when creating the product; its existing slug is not changed by editing.
8. In Admin → Products, use "Deactivate product" to hide the temporary product and show that its storefront URL is unavailable. Use "Activate product" to restore it. Permanent deletion is offered only for products unused by carts or order items.
9. Add an in-stock seeded product to the cart and select "Checkout" after cart writes finish.
10. Submit name, email, phone, and delivery address with Cash on Delivery selected. Show the order page at `/orders/DM-########` and its item/total summary. No payment is collected.
11. Refresh the order page to show persistent access. Explain that this reads the existing order; repeated checkout submissions are protected by idempotency keys and database uniqueness. Order reads require the owning customer or guest-device session.
12. Return to Admin → Orders. Search for the order, open its details, and show the contact/address snapshot, purchased item names/SKUs/prices, payment status, event timeline, and "Print receipt" action.
13. Open "Edit order" and move it through Preparing → Dispatched → Delivered. Dispatch/delivery requires a carrier and tracking number; the tracking link is optional. While dispatched, "Correct dispatch details" updates shipment details and records an event. Refresh the customer's order page to show progress and tracking.
14. Explain that checkout recalculates prices and deducts stock inside a database transaction. Demonstrate cancellation on a separate new/preparing order if desired: it restores stock once. Dispatched or delivered orders cannot be cancelled through this flow.

Payment status is a manual paid/unpaid record. Changing it transfers no money and does not issue a refund.

## Optional Buy Now, accounts, and email

- On a product page, choose a quantity and select "Buy now". Checkout uses a signed intent for that selection. Unrelated cart lines remain; matching quantities already in the source cart can be consumed by the purchase.
- Guest checkout creates an unverified customer session. Open Account and use "Send verification email", then follow the email link and set a password. Keep the original browser session until verification is complete.
- Alternatively, use `/account/register` to request a verification link, then verify and set a password. A verified customer can sign in on another device, edit their profile, and manage saved delivery addresses used at checkout.
- With working Brevo configuration, show the confirmation email and preparing/dispatched/delivered notifications for the demo order. Cancellation also has a notification. Delivery depends on the provider; a committed order remains valid if sending fails.
- Email-based order recovery is implemented by the API and `/orders/recover` confirmation page. The current My Orders screen lists accessible orders but has no recovery-request form.

## Negative-path demonstrations

- Enter an invalid price or omit the checkout phone to show browser validation. The API independently validates submitted values.
- Try creating a product with an existing SKU or slug; the API returns `409 DUPLICATE_VALUE`.
- Show that quantity controls stop at available stock or 20. For a stock-conflict demonstration, reduce stock in Admin after loading checkout; submission rechecks stock and can return `409 INSUFFICIENT_STOCK`.
- Change a product price in Admin after loading checkout; submission returns `409 PRICE_CHANGED` and requires review of the updated total.
- Explain that retrying identical checkout details with the same idempotency key recovers the original order, while conflicting reuse is rejected. A lost checkout response leads to "Resolve previous checkout"; pending details remain in tab-scoped `sessionStorage` until reconciliation or a terminal conflict.
- Open an order in a fresh browser session without signing in; knowing the order URL alone does not grant access.

## Repeatable browser checks

The scripts and CLI instructions live in [`qa/playwright`](../qa/playwright/README.md). Some scripts target earlier interfaces: `customer-smoke.js` expects quantity spinbuttons and an older confirmation URL, while `admin-smoke.js` expects variant fields and an archive dialog. They are not a verified current end-to-end suite.

`stabilization-smoke.js` targets port 3002 and exercises interrupted-checkout reconciliation. Its API/web origins must match that port. Browser scripts can create orders and alter stock/products; use disposable records and review their selectors before execution.

For automated API checks, migrate the separate test database and run the existing suite:

```powershell
node --env-file=apps/api/.env.test apps/api/scripts/migrate.js
npm test
```

The production web build command is:

```powershell
npm run build --workspace @mini-store/web
```

These commands are instructions, not a claim that tests, builds, or browser checks have passed for the current session.

## Stop after the demo

Press `Ctrl+C` in both the API and web terminals first. For the workspace's ZIP-installed MySQL, then run:

```powershell
npm run db:stop
```

This runs `db-stop.ps1`, which force-stops only `mysqld.exe` processes matching the configured installation path. For a Windows-service installation, stop the corresponding service instead.

## What not to claim

Customer accounts, saved addresses, Brevo transactional email, image uploads, order tracking, and order-event history are implemented. The dashboard summarizes the latest 100 orders; admin order/product lists support pagination.

There is no payment-provider integration, automatic courier synchronization, Google sign-in, or distributed rate limiter. This guide does not establish cloud deployment, backups, production monitoring, or production readiness. Email delivery and the full browser flow must be checked in the actual demo environment.

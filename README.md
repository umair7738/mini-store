# Danube Milano mini-store

A small sanitary-products store built for a one-day Node.js practical assessment. Guests can browse, keep a cart, and place orders with persistent 30-day order access. Customers can create accounts, manage profiles and saved addresses, and view their orders. An admin can manage products and orders. No payment is collected.

## Stack and structure

- **Node.js 26 + Express 5** handles REST requests, validation, authentication, pricing, and checkout. Express keeps the route-to-query flow easy to trace.
- **Next.js 16 App Router** renders catalogue and product pages on the server for SEO, with client components for forms and private order confirmation.
- **MySQL 8.4 InnoDB + `mysql2/promise`** stores products, carts, orders, and sessions. Foreign keys, unique constraints, row locks, and transactions protect data integrity.
- **npm workspaces** keep `apps/api` and `apps/web` separate without another build system.

| Location                   | Responsibility                                                    |
| -------------------------- | ----------------------------------------------------------------- |
| `apps/api/db/schema.sql`   | InnoDB tables, foreign keys, uniqueness, and checks                |
| `apps/api/src/products.js` | Public catalogue and protected product CRUD                      |
| `apps/api/src/cart.js`     | Guest cart cookie, persistence, item changes, and totals          |
| `apps/api/src/checkout.js` | Single-connection order and stock transaction                     |
| `apps/api/src/auth.js`     | Admin login, scrypt verification, sessions, and CSRF              |
| `apps/api/src/customerAuth.js` | Customer accounts, scrypt passwords, address ownership, and CSRF |
| `apps/api/src/guestSessions.js` | Hashed, revocable guest order sessions                           |
| `apps/api/src/orders.js`   | Owner-checked customer/guest order history, recovery, and status |
| `apps/api/src/server.js`   | Express setup, Origin check, routes, and errors                   |
| `apps/web/app/(store)`     | Public storefront, cart, checkout, and confirmation pages         |
| `apps/web/app/admin`       | Admin login, overview, rich product editor, and order workspace   |

For final delivery, see [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for the assessment walkthrough. Reproducible browser smoke checks are in [qa/playwright](qa/playwright/README.md).

## Local setup

Requires Node.js 26, npm, and MySQL **8.4** running on `127.0.0.1:3306`. MySQL 8.4.13 was installed for this workspace from Oracle's Windows ZIP distribution under `%LOCALAPPDATA%\mini-store-mysql`. The MSI required administrator privileges; the ZIP runs under the current user. The MySQL process must be started again after sign-out/reboot:

```powershell
$base = Join-Path $env:LOCALAPPDATA 'mini-store-mysql\mysql-8.4.13-winx64'
$data = Join-Path $env:LOCALAPPDATA 'mini-store-mysql\data'
$args = @("--basedir=`"$base`"", "--datadir=`"$data`"", '--port=3306', '--bind-address=127.0.0.1', '--mysqlx=OFF', "--log-error=`"$env:LOCALAPPDATA\mini-store-mysql\mysql-error.log`"")
Start-Process -FilePath (Join-Path $base 'bin\mysqld.exe') -ArgumentList $args -WindowStyle Hidden
```

On another machine, install MySQL 8.4 using Oracle's MSI with administrator rights or its supported ZIP archive. Set a root password, then run `apps/api/scripts/setup-local-db.js` once with `MYSQL_ROOT_PASSWORD` in the environment. It creates isolated `mini_store_dev` and `mini_store_test` databases, dedicated users, and ignored local environment files. It refuses to run if those files already exist, preventing accidental password rotation. Do not put credentials in source control.

The current workspace already has ignored `apps/api/.env`, `apps/api/.env.test`, and `apps/web/.env.local`. The local admin credentials are stored outside the repository in `%LOCALAPPDATA%\mini-store-mysql\admin-credentials.txt`. To set your own admin password, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters) in your shell and run `npm run admin:create`; this also invalidates existing sessions for that admin.

From the repository root:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev:api
```

In a second terminal, run `npm run dev:web`. Open <http://localhost:3000>. The API is on <http://localhost:4000>; Next.js proxies browser `/api` requests to it. Seed is safe to rerun: existing seed products are left unchanged. Run `node --env-file=.env.test scripts/migrate.js` from `apps/api` before the first test run on a fresh database.

Environment examples are in `apps/api/.env.example` and `apps/web/.env.example`. API settings include the port, allowed `WEB_ORIGIN`, MySQL credentials, and `CSRF_SECRET`. Web settings include the internal API target and public site URL. Production requires HTTPS so secure cookies work.

## Database relationships

Each `products` row owns its unique SKU, price in integer AED fils, stock, rich description, and image URL. A random guest cookie identifies a cart and a separate persistent guest-order session using stored token hashes. Guest sessions expire after `GUEST_SESSION_DAYS` (default 30) and can be revoked from My Orders. Registered customers have separate password-hashed customer sessions and saved addresses; admin authentication remains separate. Orders keep checkout contact/address snapshots and order items snapshot product name, SKU, quantity, and paid unit price. The customer-facing order number is a stable `DM-########` rendering of the database auto-increment primary key. Buy Now creates a separate checked-out cart row inside the normal stock/order transaction and does not change the shopper's active cart.

Order recovery requires a real Resend account. Set `RESEND_API_KEY` and a verified `EMAIL_FROM` sender in `apps/api/.env`. Without these values, recovery returns an explicit not-configured error and never pretends an email was sent. Recovery tokens are random, stored only as hashes, single-use, and expire after 15 minutes. Verifying an order email grants access to other orders placed with that same email and links them to an existing account with that verified email. Order snapshots are retained when customer accounts or products change.

## REST API

All paths start with `/api`. JSON errors have `{ "code": "...", "message": "..." }`. Browser writes must carry the configured Origin. Admin and signed-in customer writes also require their session-bound `X-CSRF-Token`.

| Method and path                                                 | Purpose                                            |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `GET /products`, `GET /products/:slug`                          | Active catalogue and product detail                |
| `GET /cart`                                                     | Create or retrieve guest cart with server totals   |
| `POST /cart/items`                                              | Add `{productId, quantity}`; repeated adds merge   |
| `PATCH /cart/items/:productId`                                  | Set `{quantity}`                                   |
| `DELETE /cart/items/:productId`                                 | Remove item                                        |
| `POST /checkout`                                                | Submit `{name, email, phone, address, expectedTotalFils, idempotencyKey}` |
| `GET /orders`                                                   | List orders for the signed-in customer and current guest device |
| `GET /orders/:orderNumber`                                      | Read an order only when the customer or guest session owns it |
| `POST /orders/forget-device`                                    | Revoke guest order access on the current device    |
| `POST /orders/recover`, `POST /orders/recover/verify`            | Request and redeem email-verified recovery link    |
| `/customer/register`, `/customer/login`, `/customer/session`     | Customer account and session lifecycle             |
| `/customer/profile`, `/customer/addresses`                       | Edit the account profile and saved delivery addresses |
| `POST /admin/login`, `GET /admin/session`, `POST /admin/logout` | Admin session lifecycle                            |
| `GET/POST /admin/products`                                      | List and create products                           |
| `PUT/DELETE /admin/products/:id`                                | Update or archive a product                        |
| `GET /admin/orders`, `GET /admin/orders/:id`                    | Latest orders and private order details            |
| `PATCH /admin/orders/:id/status`                                | Process, complete, or cancel and restock           |
| `PATCH /admin/orders/:id/tracking`                              | Correct details while dispatched                   |

The checkout response contains the internal `orderId`, public `publicId`, `orderNumber`, and `totalFils`. Order access is authorized by the current guest-order session or signed-in customer session; new public responses do not add a bearer confirmation token. A repeated request with the same idempotency key and immutable checkout details returns the original order; a conflicting reuse is rejected. The checkout page stores only the minimum pending request needed to reconcile a network-uncertain attempt in browser `sessionStorage`, and requires reconciliation before starting another attempt.

## Checkout safety

The server ignores client item prices. It validates the required phone number and idempotency key, reserves a durable attempt with a short lease, locks the active cart and products in ID order on **one MySQL connection and one transaction**, calculates the current total, and compares it with `expectedTotalFils`. A mismatch returns `409 PRICE_CHANGED` so the customer reviews the new amount. It then checks stock, conditionally deducts it, inserts the order and immutable item snapshots, marks the cart checked out, and commits. Every error rolls back; the connection is released. Unique `orders.cart_id` and `orders.idempotency_key` constraints guard against duplicate orders, including after an attempt record expires.

## Order operations and forms

Admins can move an order from placed → processing → completed, or cancel a placed/processing order. Cancellation locks the order and restores stock once in the same transaction. Completed orders cannot be cancelled. The dashboard shows the latest 100 orders and does not keep a separate status-event history.

Forms keep browser and backend validation. An invalid browser field receives a toast, focus, and a scroll into view. Success and API errors also appear as toast notifications. The backend remains authoritative for prices, stock, unique values, and order transitions.

The admin workspace at `/admin` has a separate responsive layout. Its overview shows active products, low-stock inventory, and recent open orders using the existing protected APIs. Product management provides search and a visual rich-text description editor. `AdminShell.jsx` verifies the session, sends CSRF tokens with writes, and provides navigation and sign-out. Overview order counts cover only the latest 100 orders returned by the API.

Staff move orders through **New order → Preparing → Dispatched → Delivered**. Dispatch requires a carrier and tracking number, records a timestamped progress event, and optionally gives the customer a tracking link on their protected confirmation page. Staff can correct dispatch tracking details while the order remains dispatched; each change records a progress event. Cancellation before dispatch returns stock inside the existing transaction. Tracking data and the event trail are stored in MySQL. Automated courier updates are not included.

## Verification performed

- `npm run db:migrate` and `npm run db:seed` succeeded against local MySQL 8.4.13; `GET /api/products` returned three seeded products.
- `npm test` passed 11 test records sequentially against **`mini_store_test`**, including product/cart behavior, security middleware, migration constraints, and real-transaction checkout replay/concurrency cases. The previous “six checks” description counted parent tests differently and was stale.
- `npm run build --workspace @mini-store/web` passed.
- Earlier browser checks covered catalogue, cart, checkout, protected confirmation, and admin workflows. The latest product-only admin screen has been build-checked.
- In the production build, browser checks confirmed invalid admin login, invalid product slug, and invalid product quantity each show a toast and focus the relevant field. The admin order dashboard displayed an existing order and its private details; no development order was changed during that check.
- The current web app production build passes after the product-only conversion.
- After restarting the API, the development database still returned the three active seeded products and the walkthrough order. The production Next.js server also rendered the homepage at a mobile viewport.

Run tests with `npm test`; they never connect to `mini_store_dev` and run sequentially because the integration fixtures share one isolated database. Tests create uniquely named records so reruns do not conflict. For a fresh local setup, apply the schema to both databases first.

## Security and limits

Passwords use salted `scrypt`; admin and customer sessions are opaque, hashed in MySQL, expire server-side, and are revoked on logout. Sensitive routes use bounded, multi-key, route-aware rate limits with `Retry-After`; the limiter is single-instance only and needs shared state before horizontal scaling. Cookies are HTTP-only, host-only, `SameSite=Lax`, and secure under production HTTPS. Unsafe requests require the expected Origin, and authenticated writes require a session-bound CSRF token. Product/order inputs are checked server-side, SQL is parameterized, request IDs are returned, and errors hide stack traces. Order access is session-owned and responses are not cached. The Next admin pages render only a client session shell before API authorization; API authorization remains the security boundary.

This assessment does not implement payment, Google OIDC, guest-order account linking, discounts, shipping fees, or cloud deployment. Before a public launch, add a distributed rate limiter, backups, HTTPS termination, deployment verification, and operational monitoring; these are separate from the assessment scope.

## Final assessment readiness

Verified local prerequisites are Node.js 26, npm 11, and MySQL 8.4. The clean setup path is: create the isolated databases with `apps/api/scripts/setup-local-db.js`, run `npm install`, apply `npm run db:migrate`, seed with `npm run db:seed`, create an admin with `npm run admin:create`, then run `npm run dev:api` and `npm run dev:web`. Tests use `node --env-file=.env.test scripts/migrate.js` and never connect to `mini_store_dev`.

The idempotent migrations apply the base schema, order-operation/tracking changes, checkout phone/idempotency changes, and product-image/quantity changes by checking the existing database first. Do not run migrations against production without a backup and an explicit deployment procedure. Existing oversized legacy cart rows are preserved and blocked from checkout rather than silently truncated.

Current verification: the sequential API suite reports 11 passing test records and the Next.js production build passes. Populated isolated-database migration and startup checks passed; a fresh empty schema could not be verified with the application DB user because it lacks `CREATE DATABASE`. Browser verification and deployment checks remain environment-dependent. This supports code verification only, not production readiness.

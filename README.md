# Danube Milano mini-store

A small sanitary-products store built for a one-day Node.js practical assessment. Guests can browse products and variants, keep a cart, and place an order. An admin can manage products and orders. No payment is collected.

## Stack and structure

- **Node.js 26 + Express 5** handles REST requests, validation, authentication, pricing, and checkout. Express keeps the route-to-query flow easy to trace.
- **Next.js 16 App Router** renders catalogue and product pages on the server for SEO, with client components for forms and private order confirmation.
- **MySQL 8.4 InnoDB + `mysql2/promise`** stores products, carts, orders, and sessions. Foreign keys, unique constraints, row locks, and transactions protect data integrity.
- **npm workspaces** keep `apps/api` and `apps/web` separate without another build system.

| Location                   | Responsibility                                                    |
| -------------------------- | ----------------------------------------------------------------- |
| `apps/api/db/schema.sql`   | InnoDB tables, foreign keys, uniqueness, and checks                |
| `apps/api/src/products.js` | Public catalogue and protected product/variant CRUD               |
| `apps/api/src/cart.js`     | Guest cart cookie, persistence, item changes, and totals          |
| `apps/api/src/checkout.js` | Single-connection order and stock transaction                     |
| `apps/api/src/auth.js`     | Admin login, scrypt verification, sessions, and CSRF              |
| `apps/api/src/orders.js`   | Protected confirmations, order status, cancellation, and refunds  |
| `apps/api/src/server.js`   | Express setup, Origin check, routes, and errors                   |
| `apps/web/app/(store)`     | Public storefront, cart, checkout, and confirmation pages         |
| `apps/web/app/admin`       | Admin login, overview, product/variant editor, and order workspace |

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

`products` have unique, immutable slugs and many `product_variants`. Each variant has a unique SKU and a key unique within its product, an optional JSON attributes object, a price in integer AED fils, and stock. The staff UI presents attributes as Finish/colour and Size/dimensions; JSON remains a database implementation detail. Products and variants are archived instead of deleted, preserving references and order history.

A guest's random cookie identifies a `cart` by its stored token hash. `cart_items` connect a cart to variants and keep quantities between 1 and 99. An `order` belongs to exactly one cart; `orders.cart_id` is unique. Orders have a current status, refund status, note, and timestamps. `order_items` snapshot the purchased names, variant details, SKU, quantity, and unit price so later catalogue edits cannot change a receipt. `admin_users` and `admin_sessions` support password-protected management.

## REST API

All paths start with `/api`. JSON errors have `{ "code": "...", "message": "..." }`. Browser writes must carry the configured Origin. Admin writes also require the `X-CSRF-Token` returned by login/session verification.

| Method and path                                                 | Purpose                                            |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `GET /products`, `GET /products/:slug`                          | Active catalogue and product detail                |
| `GET /cart`                                                     | Create or retrieve guest cart with server totals   |
| `POST /cart/items`                                              | Add `{variantId, quantity}`; repeated adds merge   |
| `PATCH /cart/items/:variantId`                                  | Set `{quantity}`                                   |
| `DELETE /cart/items/:variantId`                                 | Remove item                                        |
| `POST /checkout`                                                | Submit `{name, email, phone, address, expectedTotalFils, idempotencyKey}` |
| `GET /orders/:id`                                               | Read confirmation using `X-Order-Token`            |
| `POST /admin/login`, `GET /admin/session`, `POST /admin/logout` | Admin session lifecycle                            |
| `GET/POST /admin/products`                                      | List all and create product with initial variants  |
| `PUT/DELETE /admin/products/:id`                                | Update name/description or archive product         |
| `POST /admin/products/:id/variants`                             | Add variant                                        |
| `PUT/DELETE /admin/products/variants/:id`                       | Edit or archive variant                            |
| `GET /admin/orders`, `GET /admin/orders/:id`                    | Latest orders and private order details            |
| `PATCH /admin/orders/:id/status`                                | Process, complete, or cancel and restock           |
| `POST /admin/orders/:id/refund`                                 | Record a pending manual refund                     |
| `PATCH /admin/orders/:id/refund`                                | Mark the manual refund complete                    |

The checkout response contains `orderId`, `confirmationToken`, and `totalFils`. The browser keeps the token in `sessionStorage`, sends it in a header for the confirmation page, and never puts it in a URL. It expires after 24 hours. A repeated request with the same idempotency key and checkout details returns the original order; a conflicting reuse is rejected.

## Checkout safety

The server ignores client item prices. It validates the required phone number and idempotency key, locks the active cart and selected variants in ID order on **one MySQL connection and one transaction**, calculates the current total, and compares it with `expectedTotalFils`. A mismatch returns `409 PRICE_CHANGED` so the customer reviews the new amount. It then checks stock, conditionally deducts it, inserts the order and immutable item snapshots, marks the cart checked out, and commits. Every error rolls back; the connection is released. Unique `orders.cart_id` and `orders.idempotency_key` constraints guard against duplicate orders.

## Order operations and forms

Admins can move an order from placed → processing → completed, or cancel a placed/processing order. Cancellation locks the order and restores stock once in the same transaction. Completed orders cannot be cancelled. A cancelled or completed order can have a pending full-order manual refund note, then be marked refunded after the work is done outside this app. **These actions do not move money.** The dashboard shows the latest 100 orders and does not keep a separate status-event history.

Forms keep browser and backend validation. An invalid browser field receives a toast, focus, and a scroll into view. Success and API errors also appear as toast notifications. The backend remains authoritative for prices, stock, unique values, and order transitions.

The admin workspace at `/admin` has a separate responsive layout. Its overview shows active products, low-stock variants, recent open orders, and pending manual refunds using the existing protected APIs. Product and order pages provide search and filters; the product editor keeps creation and variant editing in expandable sections. `AdminShell.jsx` verifies the session, sends CSRF tokens with writes, and provides navigation and sign-out. Overview order counts cover only the latest 100 orders returned by the API.

Staff move orders through **New order → Preparing → Dispatched → Delivered**. Dispatch requires a carrier and tracking number, records a timestamped progress event, and optionally gives the customer a tracking link on their protected confirmation page. Cancellation before dispatch returns stock inside the existing transaction. Tracking data and the event trail are stored in MySQL. Carrier updates and automated courier updates are not included.

## Verification performed

- `npm run db:migrate` and `npm run db:seed` succeeded against local MySQL 8.4.13; `GET /api/health` returned `ok`, and `GET /api/products` returned three seeded families with two variants each.
- `npm test` passed all six integration tests against **`mini_store_test`**. They cover CRUD, duplicate slugs/SKUs, bad prices and quantities, admin auth and CSRF, cart behavior, changed totals, stock rollback, duplicate orders, competing checkout for the last unit, protected confirmation, dispatch tracking, cancellation restock, and manual refund states.
- `npm run build --workspace @mini-store/web` passed.
- Browser walkthrough completed: catalogue → product detail → add to cart → cart → checkout → protected confirmation. Admin login, product create/edit/archive, variant add/edit/archive, and logout also worked. The walkthrough placed one development order and archived its temporary demo products; three seeded families remain active.
- In the production build, browser checks confirmed invalid admin login, invalid product slug, and invalid product quantity each show a toast and focus the relevant field. The admin order dashboard displayed an existing order and its private details; no development order was changed during that check.
- The refreshed admin UI built successfully. Browser checks covered the overview, product and variant editor, order detail, sign-out, unauthenticated redirect, sign-in, and a narrow viewport. These checks did not alter development products or orders.
- After restarting the API, the development database still returned the three active seeded products and the walkthrough order. The production Next.js server also rendered the homepage at a mobile viewport.

Run tests with `npm test`; they never connect to `mini_store_dev`. Tests create uniquely named records in the test database so reruns do not conflict. For a fresh local setup, apply the schema to both databases first.

## Security and limits

Passwords use salted `scrypt`; admin sessions are hashed in MySQL, expire after 12 hours, and are deleted on logout. Login attempts are rate limited per process for five failures per minute. Cookies are HTTP-only, host-only, `SameSite=Lax`, and secure under production HTTPS. Unsafe requests require the expected Origin, and admin writes require a session-bound CSRF token. Product/order inputs are checked server-side, SQL is parameterized, and errors hide stack traces. Order confirmation requires an opaque token and is not cached. Keep `CSRF_SECRET` stable during the 24-hour confirmation window so deterministic idempotency retries can recover their confirmation token. The Next admin pages render only a client session shell before API authorization; live unauthenticated production HTML inspection found no customer, order, or session data, so API authorization remains the security boundary.

This assessment does not implement payment, customer accounts, discounts, shipping fees, email, or cloud deployment. Before a public launch, add a distributed login rate limit, backups, HTTPS termination, and operational monitoring; these are separate from the assessment scope.

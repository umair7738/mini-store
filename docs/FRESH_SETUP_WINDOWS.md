# Fresh Windows Setup for Danube Milano

This guide takes a fresh Windows 10 or Windows 11 computer from the GitHub repository to a running Danube Milano storefront, API, MySQL database, and admin workspace. It uses Windows PowerShell and only the commands that exist in this repository.

Roman Hinglish summary: pehle software install karo, phir repo clone karo, dependencies install karo, MySQL setup script chalao, migration aur seed run karo, phir API aur web ko alag terminals mein start karo.

## Quick start

Use this path on a fresh computer. Do not run the database setup script against a valuable existing mini_store_dev database: it creates the local databases and resets the dedicated local-user passwords.

### 1. Install and verify software

Install Node.js 26.x LTS and MySQL Community Server 8.4.13. Git is needed for the clone option. VS Code and Chrome are useful but optional.

Open a new PowerShell window after installation:

~~~powershell
node --version
npm --version
git --version
mysql --version
~~~

Expected working versions from this project are Node.js v26.2.0, npm 11.15.0, and MySQL 8.4.13. Node.js 20.9.0 is the verified minimum required by Next.js 16; Node 26 is the version used for this assessment.

### 2. Clone the repository

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop"
git clone https://github.com/umair7738/mini-store.git mini-store
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
git remote -v
~~~

If you downloaded a ZIP instead, extract it and run Set-Location with the extracted path. Git is not required for the ZIP option.

### 3. Install dependencies

Run this at the repository root:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm ci
~~~

npm ci reads the lockfile and installs both workspaces, apps/api and apps/web. Separate installs inside those folders are not required.

### 4. Start MySQL

If MySQL was installed with the MSI and configured as a Windows service, find the service name and start it:

~~~powershell
Get-Service | Where-Object {
  $_.Name -match 'MySQL' -or $_.DisplayName -match 'MySQL'
} | Format-Table Status,Name,DisplayName

Start-Service -Name 'REPLACE_WITH_THE_NAME_FROM_THE_TABLE'
~~~

Replace the service name only. Do not guess it; names vary by installer and machine.

Confirm the server is reachable:

~~~powershell
mysql --host=127.0.0.1 --port=3306 --user=root --password -e "SELECT VERSION() AS mysql_version;"
~~~

Enter the root password when prompted. The project expects MySQL on 127.0.0.1:3306.

### 5. Create local databases and environment files

The repository includes the supported setup script. It creates mini_store_dev and mini_store_test, creates dedicated users, grants them access, and writes ignored local environment files. Run it only once on a fresh local setup, before those files exist.

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store\apps\api"
$env:MYSQL_ROOT_PASSWORD = Read-Host 'Enter the MySQL root password'
node scripts/setup-local-db.js
Remove-Item Env:MYSQL_ROOT_PASSWORD -ErrorAction SilentlyContinue
~~~

The password is used only in the current PowerShell process and is removed afterward. If the script says local environment files already exist, stop and inspect the setup instead of deleting files or rerunning it blindly.

Roman Hinglish: ye script dev aur test ke liye alag database/user banata hai. Existing important database par mat chalao.

### 6. Apply schema and seed products

Return to the root:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run db:migrate
npm run db:seed
node --env-file=apps/api/.env.test apps/api/scripts/migrate.js
~~~

The first migration targets mini_store_dev. The second migration command targets mini_store_test, which is required before API tests on a fresh test database.

The migration runner applies the base schema and checks the order, checkout, public-order-ID, image, and cart-quantity changes. Do not run individual SQL migration files manually.

The seed creates three products with their own SKU, price, and stock. It is safe to rerun: existing product data is kept, and missing image URLs are filled.

### 7. Create a local admin

Choose your own email and password. The password must be at least 12 characters.

~~~powershell
$env:ADMIN_EMAIL = Read-Host 'Admin email'
$env:ADMIN_PASSWORD = Read-Host 'Admin password (12+ characters)'
npm run admin:create
Remove-Item Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
~~~

This stores only a salted password hash in MySQL and invalidates previous sessions for that email. Never put the password in Git or in this document.

### 8. Run the API and web app

Open two PowerShell terminals.

Terminal 1:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run dev:api
~~~

Terminal 2:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run dev:web
~~~

Open http://localhost:3000. The API health check is http://localhost:4000/api/health and should return JSON with status equal to ok.

Request flow:

~~~text
Browser -> Next.js on localhost:3000 -> Express API on localhost:4000 -> MySQL on 127.0.0.1:3306
~~~

## Software prerequisites

| Software | Recommended | Minimum or compatibility note | Why it is needed | Official download | Required? | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| Node.js | 26.x LTS; tested here with 26.2.0 | Next.js 16 requires Node.js 20.9+ | Runs the API, Next.js, migration, seed, and test scripts | https://nodejs.org/en/download | Yes | node --version |
| npm | 11.x; tested here with 11.15.0 | Bundled with Node.js; no separate project minimum is declared | Installs the root workspace and runs scripts | https://docs.npmjs.com/downloading-and-installing-node-js-and-npm | Yes | npm --version |
| MySQL Community Server | 8.4.13 LTS | The project is documented and tested with MySQL 8.4 | Stores products, carts, orders, sessions, and stock | https://dev.mysql.com/downloads/mysql/8.4.html | Yes | mysql --version and SELECT VERSION() |
| MySQL CLI | Bundled with MySQL Server 8.4.13 | No separate package is needed with the server MSI | Verifies the server and inspects local tables | Same MySQL download | Recommended | mysql --version |
| Git for Windows | Current maintained release | Not needed for a ZIP download | Clones the repository and checks remotes | https://git-scm.com/download/win | Clone workflow only | git --version |
| Visual Studio Code | Current stable | Windows 10/11 64-bit supported by the official download | Optional editor and integrated PowerShell terminal | https://code.visualstudio.com/download | Optional | code --version |
| Google Chrome | Current stable | Any modern supported browser works | Runs the storefront and admin UI | https://www.google.com/chrome/ | Optional, recommended for UI demo | Visit http://localhost:3000 |
| MySQL Workbench | Current official release | Optional; not used by the app or scripts | Optional graphical SQL inspection tool | https://dev.mysql.com/downloads/workbench/ | Optional | Connect to 127.0.0.1:3306 |
| Microsoft Visual C++ Redistributable | Latest supported x64 v14 | MySQL 8.4 on Windows requires the Microsoft C++ runtime | Runtime libraries used by MySQL Server on Windows | https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170 | Required if missing for MySQL | Check Installed apps |

Docker, Python, Java, a global Next.js install, and a global MySQL npm package are not required. The optional browser smoke checks use Playwright CLI through npx, but they are not needed to run the app manually.

### MySQL installation choices

The simplest Windows path is the MySQL 8.4 MSI plus MySQL Configurator. Choose a root password, keep TCP port 3306, and configure MySQL as a Windows service so it starts after reboot. Oracle documents the MSI as the recommended Windows method.

The official MySQL 8.4 page also provides a ZIP archive. ZIP installation is suitable for a portable or user-controlled setup, but it requires manual data-directory initialization and server startup. The repository does not initialize MySQL itself; it assumes a running server. For a beginner, use the MSI.

If a command is not recognized after installation:

~~~powershell
Get-Command mysql -ErrorAction SilentlyContinue
Get-Command node -ErrorAction SilentlyContinue
Get-Command git -ErrorAction SilentlyContinue
~~~

Close and reopen PowerShell first. If mysql is still missing after an MSI install, add the actual MySQL bin folder to the current terminal, for example:

~~~powershell
$mysqlBin = 'C:\Program Files\MySQL\MySQL Server 8.4\bin'
$env:Path = "$mysqlBin;$env:Path"
mysql --version
~~~

For a ZIP install, use the bin folder below the directory where MySQL was extracted. Do not add a guessed path permanently until Test-Path "$mysqlBin\mysql.exe" returns True.

## Download the project

### Option A: Git clone

The existing repository remote is:

~~~text
https://github.com/umair7738/mini-store.git
~~~

Fresh clone commands:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop"
git clone https://github.com/umair7738/mini-store.git mini-store
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
git remote -v
Get-ChildItem -Force
~~~

If the destination folder already exists, use a different folder name or check that the existing folder is empty before using it.

### Option B: GitHub ZIP

1. Open https://github.com/umair7738/mini-store.
2. Select Code and then Download ZIP.
3. Extract the ZIP to a path such as C:\Users\YourName\Desktop\mini-store.
4. Open that folder in VS Code with File > Open Folder, or run:

~~~powershell
code -r 'C:\Users\YourName\Desktop\mini-store'
~~~

5. Open a PowerShell terminal at the project root.

Git is not required for this option, but Git is useful later for updates and checking repository state.

## Project structure

The important files are:

~~~text
mini-store/
├── apps/
│   ├── api/
│   │   ├── db/schema.sql
│   │   ├── db/*.sql
│   │   ├── scripts/migrate.js
│   │   ├── scripts/seed.js
│   │   ├── scripts/setup-local-db.js
│   │   ├── scripts/create-admin.js
│   │   ├── src/
│   │   └── test/api.test.js
│   └── web/
│       ├── app/
│       ├── lib/
│       ├── public/images/products/
│       └── next.config.js
├── docs/
├── qa/playwright/
├── package.json
├── package-lock.json
└── README.md
~~~

apps/api is the Express backend. apps/web is the Next.js frontend. apps/api/db/schema.sql defines the base InnoDB tables. The migration runner also manages order-operations.sql, order-tracking.sql, checkout-reliability.sql, order-public-id.sql, and product-images-quantity.sql. Seed product images are stored in apps/web/public/images/products/ and referenced by paths such as /images/products/wall-hung-toilet.png.

## Install dependencies and workspaces

Run dependency installation only at the repository root:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm ci
~~~

The root package.json declares these npm workspaces:

~~~text
apps/api
apps/web
~~~

The root lockfile is present and uses lockfile version 3, so npm ci is the reproducible fresh-clone choice. It recreates node_modules from the lockfile. Do not install Next.js, Express, or mysql2 globally, and do not run separate installs in both apps.

Use npm install at the root only when deliberately changing dependencies. For a clean clone or assessment machine, use npm ci.

## Environment configuration

### Preferred method: generate local files safely

Run apps/api/scripts/setup-local-db.js after npm ci and after MySQL is running. It creates:

~~~text
apps/api/.env
apps/api/.env.test
apps/web/.env.local
~~~

These files are ignored by Git. The script generates database passwords and CSRF secrets. It refuses to run when the API local environment files already exist.

### Environment file locations

Templates are committed here:

~~~text
apps/api/.env.example
apps/web/.env.example
~~~

The API template contains:

| Variable | Example shape | Purpose |
| --- | --- | --- |
| PORT | 4000 | Express listening port. |
| WEB_ORIGIN | http://localhost:3000 | Exact browser origin accepted for unsafe requests. |
| DB_HOST | 127.0.0.1 | MySQL host. |
| DB_PORT | 3306 | MySQL TCP port. |
| DB_USER | mini_store_dev | Dedicated local database user. |
| DB_PASSWORD | generated value | Password for that database user. |
| DB_NAME | mini_store_dev | Database used by the API. |
| CSRF_SECRET | generated random value | HMAC secret. It must be at least 32 characters and remain stable while 24-hour confirmation retries may occur. |
| NODE_ENV | development or test | Process environment label. |

The web template contains:

| Variable | Example shape | Purpose |
| --- | --- | --- |
| API_TARGET | http://127.0.0.1:4000 | Destination for Next.js /api/* rewrites. |
| NEXT_PUBLIC_SITE_URL | http://localhost:3000 | Site URL used by sitemap and robots metadata. |

The source defaults DB_HOST to 127.0.0.1, DB_PORT to 3306, API port to 4000, API target to http://127.0.0.1:4000, and site URL to http://localhost:3000, but use the generated files so credentials and origin are explicit.

### Manual environment-file fallback

Only use this fallback if you are not using setup-local-db.js. Copy the templates, then edit each value to match databases and users that already exist:

~~~powershell
Copy-Item -LiteralPath apps/api/.env.example -Destination apps/api/.env
Copy-Item -LiteralPath apps/api/.env.example -Destination apps/api/.env.test
Copy-Item -LiteralPath apps/web/.env.example -Destination apps/web/.env.local
notepad apps/api/.env
notepad apps/api/.env.test
notepad apps/web/.env.local
~~~

For the test file, use DB_NAME=mini_store_test and the matching test user/password. The API .env and .env.test must not be identical if you want tests isolated from development. Keep real values out of GitHub.

To generate a strong local secret in PowerShell:

~~~powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
~~~

Paste the output into CSRF_SECRET. Keep it stable while active sessions and checkout retries are in use.

## MySQL setup from zero

### Recommended MSI path

1. Download MySQL 8.4.13 Windows MSI from https://dev.mysql.com/downloads/mysql/8.4.html.
2. Run the installer and MySQL Configurator.
3. Set a root password and record it in a local password manager.
4. Keep the server on port 3306.
5. Configure it as a Windows service.
6. Open a new PowerShell window and verify with mysql --version.
7. Start the service if it is not running.
8. Run the repository setup script. It creates mini_store_dev and mini_store_test; you do not create them manually.

### Optional ZIP path

The official MySQL page also provides mysql-8.4.13-winx64.zip. Extract it to a protected folder such as C:\mysql, initialize/configure it using the official MySQL Windows instructions, and start mysqld on 127.0.0.1:3306. The ZIP path does not automatically create a Windows service or add mysql.exe to PATH. Follow https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html for initialization and service details.

### Verify and initialize

~~~powershell
mysql --host=127.0.0.1 --port=3306 --user=root --password -e "SELECT VERSION() AS mysql_version;"
~~~

Inside the MySQL client:

~~~sql
SELECT VERSION();
EXIT;
~~~

The repository setup script is the source of truth for database initialization:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store\apps\api'
$env:MYSQL_ROOT_PASSWORD = Read-Host 'Enter the MySQL root password'
node scripts/setup-local-db.js
Remove-Item Env:MYSQL_ROOT_PASSWORD -ErrorAction SilentlyContinue
~~~

It creates:

~~~text
mini_store_dev  <- development API
mini_store_test <- API integration tests
~~~

It also creates users named mini_store_dev and mini_store_test, grants each user access to its database, and writes ignored env files. It does not create an admin account.

### Apply migrations and seed

From the root:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run db:migrate
npm run db:seed
node --env-file=apps/api/.env.test apps/api/scripts/migrate.js
~~~

Do not execute raw migration files one by one. migrate.js checks the current schema before applying each needed change and backfills public order IDs safely.

Verify development tables and records without changing them:

~~~powershell
mysql --host=127.0.0.1 --port=3306 --user=mini_store_dev --password mini_store_dev -e "SHOW TABLES; SELECT COUNT(*) AS products FROM products;"
~~~

Type the generated mini_store_dev password when prompted. A fresh seed should report three products.

## Start the backend API

Development API command:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run dev:api
~~~

This calls the API workspace dev script, which runs node --env-file=.env --watch src/server.js. The API listens on port 4000 by default and reloads when source files change.

Verify it from another PowerShell window:

~~~powershell
Invoke-RestMethod http://localhost:4000/api/health
Invoke-RestMethod http://localhost:4000/api/products
~~~

The health result should have status equal to ok; the products result should contain the three seeded families.

## Start the Next.js frontend

Open a second PowerShell terminal:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run dev:web
~~~

This calls next dev in apps/web. It listens on port 3000. next.config.js rewrites browser requests from /api/* to API_TARGET, normally http://127.0.0.1:4000.

Open http://localhost:3000.

Request flow:

~~~text
Browser -> Next.js -> Express API -> MySQL
~~~

## Application URLs

### Customer pages

| Page | URL |
| --- | --- |
| Home | http://localhost:3000/ |
| Shop | http://localhost:3000/shop |
| Wall-hung toilet | http://localhost:3000/products/milano-wall-hung-toilet |
| Countertop basin | http://localhost:3000/products/milano-countertop-basin |
| Shower mixer | http://localhost:3000/products/milano-shower-mixer |
| Cart | http://localhost:3000/cart |
| Checkout | http://localhost:3000/checkout |
| Checkout success | The app navigates to /checkout/success?order=<publicId> after checkout. |
| Protected order view | `/orders/<orderNumber>` is authorized by the current guest-order session or signed-in customer session. |

The public order URL uses the opaque UUID publicId, not the internal numeric orderId. Do not invent a UUID for a manual test; complete checkout and follow the link the app creates.

### Admin pages

| Page | URL |
| --- | --- |
| Login | http://localhost:3000/admin/login |
| Overview | http://localhost:3000/admin |
| Products | http://localhost:3000/admin/products |
| Create product | http://localhost:3000/admin/products/new |
| Edit product | The product list provides /admin/products/<id>/edit. |
| Orders | http://localhost:3000/admin/orders |

### Direct API URLs

~~~text
GET http://localhost:4000/api/health
GET http://localhost:4000/api/products
GET http://localhost:4000/api/products/milano-wall-hung-toilet
~~~

The browser normally calls /api/* through the Next.js rewrite, so customer cookies stay on the storefront origin.

## Manual end-to-end test

Use disposable demo data only.

1. Open Home and confirm the three seeded product families appear.
2. Open Shop and select a product.
3. Open a product detail page using one verified slug.
4. Select a quantity, then add the product to the cart.
5. Open Cart, update the quantity, and remove an item.
6. Add another item and refresh. The guest cart should persist through the HTTP-only cart cookie and MySQL.
7. Open Checkout and enter name, email, phone, and address.
8. Submit the order. The API recalculates price, checks stock, deducts stock in a transaction, and returns an order reference. A network-uncertain retry keeps the same idempotency key and must be reconciled before a new attempt.
9. Confirm that the app navigates to the protected success page.
10. Refresh the confirmation page. It should show the same order rather than create a second order.
11. Open /admin/login and sign in with the admin account you created.
12. Open Admin > Orders and inspect the customer phone, item snapshot, total, status, and stock result.
13. Move the order from placed to processing. To dispatch it, provide carrier and tracking number; then move it to delivered.
14. Create a temporary product with an image path, SKU, price, and stock.
15. Edit its price and stock, then return to the storefront and confirm the change.
16. Archive the temporary product and confirm it disappears from the public catalogue.
17. Log out and confirm that opening an admin page redirects to login.

Expected negative checks:

- Admin product validation rejects non-positive prices, invalid stock, and duplicate SKUs.
- Checkout without a valid phone is rejected.
- A changed server price returns 409 PRICE_CHANGED.
- A repeated idempotency key replays the original order; conflicting details are rejected.
- Dispatch without carrier and tracking number is rejected.

## Development and production-build commands

Run these from the repository root:

| Purpose | Command |
| --- | --- |
| Install reproducibly | npm ci |
| Install while changing dependencies | npm install |
| Migrate development DB | npm run db:migrate |
| Seed development DB | npm run db:seed |
| Migrate test DB | node --env-file=apps/api/.env.test apps/api/scripts/migrate.js |
| Create/update admin | npm run admin:create |
| Run API tests | npm test |
| API development server | npm run dev:api |
| Web development server | npm run dev:web |
| Build web production bundle | npm run build --workspace @mini-store/web |
| Start built web server | npm run start --workspace @mini-store/web |
| Start API without watch mode | npm run start --workspace @mini-store/api |

There is no root npm run dev, root npm run build, or root npm run start script. Use the workspace commands shown above. The API is plain JavaScript and needs no transpilation.

Production-style web check:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run build --workspace @mini-store/web
~~~

Then keep the API running in one terminal and run the built web server in another:

~~~powershell
npm run start --workspace @mini-store/api
npm run start --workspace @mini-store/web
~~~

The API start script reads apps/api/.env; the web start script serves the generated .next build. Stop both with Ctrl+C. For an assessment demo, the development commands are simpler.

## Troubleshooting

| Problem | What to check and fix |
| --- | --- |
| node is not recognized | Reinstall Node.js, accept the PATH option, open a new PowerShell window, then run node --version. |
| npm is not recognized | npm is bundled with Node.js. Reopen PowerShell or repair the Node.js installation. |
| git is not recognized | Install Git for Windows, or use the GitHub ZIP workflow instead. |
| mysql is not recognized | Add the actual MySQL bin folder to the current PATH as shown above. |
| MySQL service is stopped | Discover it with Get-Service *mysql* and start the exact name with Start-Service. |
| MySQL connection refused | Check the server with Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue. |
| Access denied for a database user | Compare DB_USER, DB_PASSWORD, and DB_NAME in the correct local env file. Do not expose a password in a command line. |
| Unknown database | On a fresh machine, run setup-local-db.js after npm ci; it creates both expected databases. |
| Missing tables | Run npm run db:migrate for development and the explicit test migration before npm test. |
| Migration failure | Check MySQL version, port, credentials, and whether a previous partial setup left incompatible tables. Use a disposable fresh database for assessment setup. |
| Seed failure | Run migration first and confirm the API user can write to the selected database. |
| Missing environment configuration | On a fresh setup, inspect incomplete disposable env files, then rerun the setup script only after confirming the machine is disposable. Otherwise copy the examples and edit them manually. |
| Port 3000 already in use | Stop the existing process or use npm run dev --workspace @mini-store/web -- -p 3001. Also change WEB_ORIGIN and NEXT_PUBLIC_SITE_URL to http://localhost:3001, then restart both. |
| API port already in use | Change API PORT and web API_TARGET together, then restart both processes. |
| Frontend loads but products are missing | Check http://localhost:4000/api/products, then check API_TARGET in apps/web/.env.local and restart Next.js. |
| Browser requests return 401 | Admin-only endpoints need an active session. Log in at /admin/login. |
| Browser writes return 403 | WEB_ORIGIN must exactly match the browser origin, including host and port. |
| Admin login fails | Confirm the admin was created with npm run admin:create and use the same email and chosen password. |
| CSRF token errors | Use the browser admin UI, keep the session cookie, do not mix hosts, and keep CSRF_SECRET stable. |
| Product images are missing | Confirm PNG files exist under apps/web/public/images/products/ and seeded paths begin with /images/products/. |
| Cart does not persist | Keep the same browser host, allow cookies, and confirm the API is running. |
| Checkout fails | Check phone validation, stock, and the displayed total. PRICE_CHANGED means refresh the cart. |
| Missing or short CSRF secret | Generate a random value of at least 32 characters, update CSRF_SECRET, and restart the API. |
| Next.js build fails | Run npm ci with Node 20.9+ and run npm run build --workspace @mini-store/web. Check .env.local. |

## Daily startup and shutdown

After one-time installation, dependencies, database setup, migrations, seed, and admin creation do not need to run every day.

1. Start the MySQL Windows service if it is not already running.
2. Terminal 1:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run dev:api
~~~

3. Terminal 2:

~~~powershell
Set-Location -LiteralPath 'C:\Users\Umair shaikh\Desktop\mini-store'
npm run dev:web
~~~

4. Visit http://localhost:3000.
5. Press Ctrl+C in each Node terminal when finished. Leave the MySQL service running if you want it available tomorrow, or stop it from Windows Services.

## Verification and boundaries

The repository was checked against the actual package scripts, environment templates, source configuration, migration runner, seed script, Next.js rewrite, and Git remote. The project was verified with Node.js 26.2.0, npm 11.15.0, and MySQL 8.4.13. The sequential API test suite currently reports 11 passing test records after the test database migration, and the Next.js build passes. Populated isolated-database migration and seed reruns passed; fresh empty-database verification requires an authorized disposable schema owner because the application test user lacks `CREATE DATABASE`.

The guide does not promise production readiness. The project intentionally has no payment provider, Google OIDC, guest-order account linking, cloud deployment, distributed rate limiter, backups, or production monitoring. Optional browser smoke checks are documented in qa/playwright/README.md and must use disposable data.


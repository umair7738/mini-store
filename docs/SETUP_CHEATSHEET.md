# Danube Milano Windows Setup Cheatsheet

Use PowerShell. Replace only values explicitly marked as local choices. Run commands from the repository root unless a different directory is shown.

## One-time setup

~~~powershell
# Verify tools
node --version
npm --version
git --version
mysql --version

# Clone the actual repository
Set-Location -LiteralPath "$HOME\Desktop"
git clone https://github.com/umair7738/mini-store.git mini-store
Set-Location -LiteralPath "$HOME\Desktop\mini-store"

# Install both npm workspaces from the lockfile
npm ci

# Start the MySQL Windows service after discovering its exact name
Get-Service | Where-Object {
  $_.Name -match 'MySQL' -or $_.DisplayName -match 'MySQL'
} | Format-Table Status,Name,DisplayName
Start-Service -Name 'REPLACE_WITH_THE_MYSQL_SERVICE_NAME'

# Create databases, users, and ignored env files
Set-Location -LiteralPath "$HOME\Desktop\mini-store\apps\api"
$env:MYSQL_ROOT_PASSWORD = Read-Host 'Enter the MySQL root password'
node scripts/setup-local-db.js
Remove-Item Env:MYSQL_ROOT_PASSWORD -ErrorAction SilentlyContinue

# Apply development schema and seed products
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run db:migrate
npm run db:seed

# Apply schema to the isolated test database
node --env-file=apps/api/.env.test apps/api/scripts/migrate.js

# Create an admin account
$env:ADMIN_EMAIL = Read-Host 'Admin email'
$env:ADMIN_PASSWORD = Read-Host 'Admin password (12+ characters)'
npm run admin:create
Remove-Item Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue

# Verify tests and production web build
npm test
npm run build --workspace @mini-store/web
~~~

## Start the app

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

Open:

~~~text
http://localhost:3000
http://localhost:3000/shop
http://localhost:3000/admin/login
http://localhost:4000/api/health
~~~

## Daily restart

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run dev:api
~~~

In a second terminal:

~~~powershell
Set-Location -LiteralPath "$HOME\Desktop\mini-store"
npm run dev:web
~~~

Do not run npm ci, setup-local-db.js, migrations, or seed every day. Press Ctrl+C in both Node terminals to stop them.

## Useful commands

~~~powershell
# Development database
npm run db:migrate
npm run db:seed

# Test database
node --env-file=apps/api/.env.test apps/api/scripts/migrate.js
npm test

# Admin account
npm run admin:create

# Production-style web build and server
npm run build --workspace @mini-store/web
npm run start --workspace @mini-store/web

# API without file watching
npm run start --workspace @mini-store/api
~~~


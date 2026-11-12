# Browser smoke checks

These checks use the already available Playwright CLI through `npx`; they do not add a project dependency.

Start an isolated database, API, and web server first. From the repository root:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=phase4 open http://localhost:3000 --headed
npx --yes --package @playwright/cli playwright-cli -s=phase4 run-code --filename qa/playwright/customer-smoke.js
npx --yes --package @playwright/cli playwright-cli -s=phase4 run-code --filename qa/playwright/negative-checks.js
npx --yes --package @playwright/cli playwright-cli -s=phase4 run-code --filename qa/playwright/route-matrix.js
```

For the admin check, log in through the same `phase4` browser session using the disposable admin credentials, then run:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=phase4 run-code --filename qa/playwright/admin-smoke.js
```

The customer smoke check creates one disposable order. The admin smoke check creates and archives one disposable product. Run both only against a demo/test database.

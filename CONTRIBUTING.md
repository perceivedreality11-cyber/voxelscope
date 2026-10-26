# Contributing

Use Node.js 24.x. No runtime dependency installation is required.

```bash
npm run check
npm test
npm run test:load
```

Numerical changes should include independently known results, not just tests that repeat the implementation. Preserve native uint16 intensity comparisons, physical spacing, ROI denominators, connectivity, and the distinction between raw and size-filtered porosity.

API changes must preserve tenant scoping and role checks. Use synthetic fixtures, never customer data or credentials. Update API and measurement documentation when behavior changes.

For browser changes, run the optional Playwright workflow:

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:browser
```

The browser regression creates a temporary workspace and generates screenshots under `docs/screenshots/`. Set `SCREENSHOT_DIR` to a temporary directory when screenshots do not need to be updated. Screenshots should come from the running application, clearly identify synthetic data, and avoid real account information.

Regenerate the editable documentation diagrams with `npm run docs:diagrams`. Keep diagram labels consistent with implemented behavior. Numerical and concurrent-session measurements are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

Before opening a pull request, describe the concrete behavior change and the checks you ran. Security reports belong in a private channel; see SECURITY.md.

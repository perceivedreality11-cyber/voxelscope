# Contributing

Use Node.js 24.x. No runtime dependency installation is required.

```bash
npm run check
npm test
```

Numerical changes should include independently known results, not just tests that repeat the implementation. Preserve native uint16 intensity comparisons, physical spacing, ROI denominators, connectivity, and the distinction between raw and size-filtered porosity.

API changes must preserve tenant scoping and role checks. Use synthetic fixtures, never customer data or credentials. Update API and measurement documentation when behavior changes.

For browser changes run the optional Playwright workflow in README. Screenshots should come from the running application, clearly identify synthetic data, and avoid real account information.

Before opening a pull request, describe the concrete behavior change and the checks you ran. Security reports belong in a private channel; see SECURITY.md.

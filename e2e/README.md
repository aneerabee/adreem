# Visual and layout checks

The tests use a deterministic synthetic ledger and intercept every `/api/*` request. They never read or write a production ledger.

- `pnpm test:layout`: checks Arabic and English across desktop Chromium, mobile Chromium, and mobile WebKit. It scans populated and empty ledgers, main sections, balance tabs, both scroll layers, forms, filters, and dialogs for horizontal overflow, escaped controls, overlapping navigation, and clipped headings.
- `pnpm test:visual`: compares the five main sections, six balance groups, and key forms and overlays in both languages against viewport screenshots for all three browser projects.
- `pnpm test:visual:update`: updates screenshot baselines after an intentional design change. Review the changed images before committing them.

Install browser binaries once with `pnpm exec playwright install chromium webkit`. Screenshot baselines are specific to macOS font rendering; continuous integration runs the geometry and interaction checks on Chromium instead. Test failures save screenshots and browser traces in ignored local output directories.

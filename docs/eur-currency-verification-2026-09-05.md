# EUR and Missing Currency Accounts

## Scope

- Support EUR alongside LYD, USD and TRY in account creation, postings, balances, filters, statements, separate records and net conversion.
- Net exchange rates always mean units of the selected currency per one USD.
- Complete missing TRY/EUR accounts for existing people and owned cash/bank locations with zero openings. Preserve old IDs, amounts and movements.
- Preserve legacy name-based person grouping without creating an incomplete explicit bundle.
- Use deterministic account IDs, a completion marker and the existing revision-aware save path. Do not re-create a removed channel on every reload.
- Do not add currencies to archived accounts, expense categories or project/asset records automatically.

## Verified Locally

- Type checking, lint and production build succeeded.
- 730 unit/integration tests passed across 40 files.
- Applied the complete migration chain to an isolated PostgreSQL 17 instance.
- 51 real database assertions passed: openings, transfers, edits, cancellation, income, expense, reports, immutable openings, negative owned-balance rejection and owner/ledger isolation across all four currencies.
- Browser tests on widths 1440, 390 and 360, in Arabic and English: the actual app saved currency completion once, preserved old movements, retained the result on reload, calculated EUR net correctly, and created a five-channel person with a negative EUR opening.
- Checked rendered screenshots and summary child geometry; fixed mobile clipping when additional currencies are present.
- Browser verification used an isolated intercepted cloud endpoint, never production ledger data.

## Deployment Gate

Do not publish the EUR web interface before the backend supports it.

1. Renew the operator's Tailscale SSH check and inspect the actual server service, checkout and active storage mode.
2. Take the normal server backup, then update the backend to this reviewed revision.
3. For relational storage, apply `20260905170000_add_eur_currency.sql` through the tracked migration process before restarting the new backend. For legacy JSON storage this migration is not required for the active path.
4. Verify service health and readiness before manually publishing the web workflow.
5. Verify the deployed web asset and backend revision, and test persistence with a dedicated test ledger, not financial production entries.

At verification time, the live legacy web endpoint and API health were reachable. SSH required additional identity verification, so live backend/currency publication was not confirmed. Git push alone does not publish the manual-only web workflow.

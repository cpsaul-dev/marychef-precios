# marychef-precios

Data-only repo: a filtered daily snapshot of Austrian supermarket food prices for the MaryChef app.

## Sources
- [heisse-preise](https://github.com/badlogic/heissepreise) (MIT), `https://heisse-preise.io/data/latest-canonical.json`. A store is only used while heisse-preise updated it in the last 45 days. Today that is only **BILLA**.
- **BILLA fallback**: when heisse-preise fails or looks wrong for BILLA, the public JSON API of shop.billa.at (`/api/product-discovery`, no token; robots.txt allows it) is read directly, food categories only, one request per second. Parsing and category codes follow heisse-preise.
- **SPAR**: heisse-preise stopped on 2026-09-27, SPAR's old search API is gone, and spar.at's product pages are behind a bot check, so nothing here reads spar.at. `data/spar.json` comes from a SPAR price export (CSV) imported with `scripts/import-spar-csv.js`. The CSV has no shop categories, so only products that are one of the app's ingredients (`scripts/lib/foods.js`, copied from the app's `FoodMatchRules.kt`) are kept, at their regular price (promotions are dropped). The daily GitHub run keeps the last SPAR file for up to 14 days, so a new export is needed about every two weeks.
- **HOFER**: Hofer closed its online food shop on 30 June 2026; hofer.at only sells non-food online.
- **LIDL**: not in any source.
- Only food is kept (drinks, drugstore, household, pets and ready meals are dropped).

## Files
- `data/<store>.json`: one compact file per supermarket, rows `[id, name, priceEur, unit (g|ml|stk), quantity, bio, weighted, category]`. Food only.
- `data/meta.json`: date, columns, `bySupermarket` counts and `stores` (per store `updatedAt`, `source`, and `stale: true` when the last download failed and the previous file was kept).

## Resilience
- Every download has a timeout and retries with backoff; 4xx answers are not retried.
- Each store is independent: one failing never blocks the others.
- Data is validated before it is written (minimum rows, units, prices, duplicate ids). Bad data never replaces good data.
- A store whose download fails keeps its last good file for up to 14 days, then leaves `meta.json` so the app does not show old prices.

## Running
- `node scripts/import-spar-csv.js <export.csv>`: writes `data/spar.json` and `data/meta.json` from a SPAR export and prints what was dropped and why (`DRY_RUN=1` only prints). Commit `data/` afterwards.
- `node --test scripts/test/*.test.js`: offline tests.
- `DRY_RUN=1 node scripts/filter-austrian-prices.js`: download and print, write nothing.
- The workflow publishes daily from `main`; a push to any other branch runs the tests and a dry run.

No app code, no personal data.

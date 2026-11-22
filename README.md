# marychef-precios

Data-only repo: a filtered daily snapshot of Austrian supermarket food prices for the MaryChef app.

## Sources
- [heisse-preise](https://github.com/badlogic/heissepreise) (MIT), `https://heisse-preise.io/data/latest-canonical.json`. A store is only used while heisse-preise updated it in the last 45 days. Today that is only **BILLA**.
- **BILLA fallback**: when heisse-preise fails or looks wrong for BILLA, the public JSON API of shop.billa.at (`/api/product-discovery`, no token; robots.txt allows it) is read directly, food categories only, one request per second. Parsing and category codes follow heisse-preise.
- **SPAR**: heisse-preise stopped on 2026-09-27. SPAR's old public search channel is gone, and spar.at's Produktwelt now loads prices from a private API that needs a token issued to the web page (and spar.at answers 403 to GitHub's servers). It is not read here on purpose.
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
- `node --test scripts/test/*.test.js`: offline tests.
- `DRY_RUN=1 node scripts/filter-austrian-prices.js`: download and print, write nothing.
- The workflow publishes daily from `main`; a push to any other branch runs the tests and a dry run.

No app code, no personal data.

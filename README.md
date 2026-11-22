# marychef-precios

Data-only repo: a filtered daily snapshot of Austrian supermarket food prices for the MaryChef app.

## Sources
- **BILLA** (and MPREIS / Unimarkt if they become fresh again): [heisse-preise](https://github.com/badlogic/heissepreise) (MIT), `https://heisse-preise.io/data/latest-canonical.json`. A store is only used while heisse-preise updated it in the last 45 days.
- **SPAR**: the public product search that interspar.at uses (`search-spar.spar-ics.com`, FactFinder `products_lmos_at`). heisse-preise stopped updating SPAR, so it is read directly, once a day, in one request (or small pages with a pause if that fails), with an identifying User-Agent. robots.txt of spar.at and interspar.at does not disallow it. Parsing and the category map (`scripts/lib/spar-categories.json`) come from heisse-preise (MIT).
- **HOFER**: not available. Hofer closed its online food shop on 30 June 2026; hofer.at only sells non-food online.
- **LIDL**: not in any source.

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
- The workflow publishes daily from `main`; a push to any other branch runs the tests and a dry run against the live sources.

No app code, no personal data.

#!/usr/bin/env node
"use strict";
// Refreshes data/spar.json from SPAR's public Produktwelt pages. Run it on a normal connection
// (spar.at refuses GitHub's servers), about once a week:
//   node scripts/update-spar.js            # writes data/spar.json and data/meta.json
//   DRY_RUN=1 MAX_PAGES=30 node scripts/update-spar.js   # quick check, writes nothing
// Then commit and push data/ (scripts/update-spar.sh does all of it).
const path = require("node:path");
const spar = require("./lib/spar");
const { publishStores } = require("./lib/publish");
const { isFood } = require("./filter-austrian-prices");

const OUT_DIR = process.env.OUT_DIR || path.resolve(__dirname, "..", "data");

async function main() {
  let result;
  try {
    const rows = (await spar.fetchRows({ maxPages: Number(process.env.MAX_PAGES || Infinity), pauseMs: Number(process.env.PAUSE_MS || 1000) })).filter(isFood);
    console.log(`SPAR: ${rows.length} food rows`);
    result = { rows, minRows: Number(process.env.MIN_ROWS || 300), source: "https://www.spar.at/produktwelt (public pages)" };
  } catch (e) {
    console.warn(`SPAR failed: ${e.message}`);
    result = { error: e.message, minRows: 300 };
  }
  if (process.env.DRY_RUN === "1") {
    console.log("[dry run]", result.rows ? `${result.rows.length} rows, e.g. ${JSON.stringify(result.rows.slice(0, 5))}` : result.error);
    return;
  }
  const meta = publishStores(OUT_DIR, { SPAR: result }, { keepOthers: true });
  console.log("meta:", JSON.stringify(meta.bySupermarket));
  if (result.error) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";
// Writes one compact file per supermarket: data/<store>.json, plus data/meta.json.
// Each row: [id, name, price, unit, quantity, bio(0/1), weighted(0/1), category]
//  - BILLA (and any other store heisse-preise still updates) comes from heisse-preise (MIT).
//  - SPAR comes straight from the SPAR product search, because heisse-preise stopped updating it.
//  - HOFER has no online food shop since 30 June 2026, so there is nothing to read.
// Each store is independent: if one fails, the others are still published and the failed one keeps
// its last good file (see lib/publish.js).
const path = require("node:path");
const spar = require("./lib/spar");
const { publishStores } = require("./lib/publish");

const SOURCE_URL = process.env.HEISSE_PREISE_URL || "https://heisse-preise.io/data/latest-canonical.json";
const OUT_DIR = process.env.OUT_DIR || path.resolve(__dirname, "..", "data");
const HP_STORES = { billa: "BILLA", mpreis: "MPREIS", unimarkt: "UNIMARKT" };
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 45);
const MIN_ROWS = { BILLA: 1000, SPAR: 1000, MPREIS: 500, UNIMARKT: 500 };

// heisse-preise category codes to drop: non-food, pets, baby, alcohol (except wine 25), drinks, desserts, prepared dishes.
const CATEGORY_DROP = new Set(["20","21","22","23","24","26","27","29","33","37","43","42","44","45","46","47","48","5E","5F",
  "70","71","72","73","80","81","82","83","84","85","86","87","88","89","90","91","B0","B1","B2","B3","B4","B5","D0","D2","D3"]);
const NAME_DROP = /reiniger|waschmittel|spülmittel|weichspüler|shampoo|duschgel|zahnpasta|zahncreme|windel|katzen|hunde?futter|toilettenpapier|küchenrolle|müllsack|rasier|deo\b|parfum|kerze|batterie|glühbirne|pizza|fertiggericht|menü\b|bowl\b/i;

/** Only food: the app keeps what matches its ingredients, so non-food is just weight. */
function isFood(row) {
  return !CATEGORY_DROP.has(String(row[7])) && !NAME_DROP.test(String(row[1]));
}

async function fromHeissePreise() {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${SOURCE_URL}`);
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error("Unexpected heisse-preise payload (not an array)");
  // A store is live when any of its items had a price change within MAX_AGE_DAYS.
  const newest = {};
  for (const i of items) {
    const d = (i.priceHistory || []).map((h) => h.date).sort().pop();
    if (d && (!newest[i.store] || d > newest[i.store])) newest[i.store] = d;
  }
  console.log("heisse-preise newest change per store:", newest);
  const out = {};
  for (const [store, id] of Object.entries(HP_STORES)) {
    const live = newest[store] && (Date.now() - Date.parse(newest[store])) / 864e5 <= MAX_AGE_DAYS;
    out[id] = live ? { rows: [] } : { error: `heisse-preise has nothing newer than ${MAX_AGE_DAYS} days` };
  }
  const seen = new Set();
  for (const i of items) {
    const id = HP_STORES[i.store];
    if (!id || i.unavailable || !out[id].rows) continue;
    const price = Number(i.price);
    const name = String(i.name || "").trim();
    if (!Number.isFinite(price) || price <= 0 || !name || seen.has(`${id}:${i.id}`)) continue;
    seen.add(`${id}:${i.id}`);
    const row = [
      String(i.id), name, Math.round(price * 100) / 100, String(i.unit || ""),
      Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : null,
      i.bio ? 1 : 0, i.isWeighted ? 1 : 0, i.category == null ? "" : String(i.category),
    ];
    if (isFood(row)) out[id].rows.push(row);
  }
  return out;
}

async function fromSpar() {
  const hits = await spar.fetchCatalog();
  if (process.env.DRY_RUN === "1" && hits[0]) console.log("[dry run] SPAR sample hit:", JSON.stringify(hits[0]).slice(0, 3000));
  const rows = [];
  const seen = new Set();
  let unparsed = 0;
  for (const hit of hits) {
    const row = spar.toRow(hit);
    if (!row) {
      unparsed++;
      continue;
    }
    if (seen.has(row[0]) || !isFood(row)) continue;
    seen.add(row[0]);
    rows.push(row);
  }
  console.log(`SPAR: ${hits.length} hits, ${unparsed} not parsable, ${rows.length} food rows`);
  return rows;
}

async function main() {
  const results = {};
  const [hp, sp] = await Promise.allSettled([fromHeissePreise(), fromSpar()]);
  if (hp.status === "fulfilled") {
    for (const [id, r] of Object.entries(hp.value)) results[id] = { ...r, minRows: MIN_ROWS[id], source: SOURCE_URL };
  } else {
    console.warn(`heisse-preise failed: ${hp.reason?.message || hp.reason}`);
    for (const id of Object.values(HP_STORES)) results[id] = { error: "heisse-preise download failed", minRows: MIN_ROWS[id] };
  }
  results.SPAR = sp.status === "fulfilled"
    ? { rows: sp.value, minRows: MIN_ROWS.SPAR, source: "search-spar.spar-ics.com (products_lmos_at)" }
    : { error: `SPAR download failed: ${sp.reason?.message || sp.reason}`, minRows: MIN_ROWS.SPAR };

  if (process.env.DRY_RUN === "1") {
    for (const [id, r] of Object.entries(results)) console.log(`[dry run] ${id}:`, r.rows ? `${r.rows.length} rows, e.g. ${JSON.stringify(r.rows.slice(0, 3))}` : r.error);
    return;
  }
  const meta = publishStores(OUT_DIR, results);
  console.log("meta:", JSON.stringify(meta.bySupermarket));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { isFood };

#!/usr/bin/env node
"use strict";
// Writes one compact file per supermarket from heisse-preise (MIT): data/<store>.json
// Each row: [id, name, price, unit, quantity, bio(0/1), weighted(0/1), category]
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_URL = process.env.HEISSE_PREISE_URL || "https://heisse-preise.io/data/latest-canonical.json";
const OUT_DIR = path.resolve(__dirname, "..", "data");
// heisse-preise has no LIDL. MPREIS and Unimarkt are extra Austrian food chains.
const STORES = { billa: "BILLA", spar: "SPAR", hofer: "HOFER", mpreis: "MPREIS", unimarkt: "UNIMARKT" };

// Only current data: heisse-preise no longer updates SPAR/HOFER/MPREIS/UNIMARKT (all flagged unavailable);
// a store is published again automatically once its items are fresh.
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 45);
// BILLA category codes to drop: non-food, pets, baby, alcohol (except wine 25), drinks, desserts, prepared dishes.
const BILLA_DROP = new Set(["20","21","22","23","24","26","27","29","33","37","43","42","44","45","46","47","48","5E","5F",
  "70","71","72","73","80","81","82","83","84","85","86","87","88","89","90","91","B0","B1","B2","B3","B4","B5","D0","D2","D3"]);
const NAME_DROP = /reiniger|waschmittel|spülmittel|weichspüler|shampoo|duschgel|zahnpasta|zahncreme|windel|katzen|hunde?futter|toilettenpapier|küchenrolle|müllsack|rasier|deo\b|parfum|kerze|batterie|glühbirne|pizza|fertiggericht|menü\b|bowl\b/i;

function main() {
  return fetch(SOURCE_URL).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to fetch ${SOURCE_URL}: HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items)) throw new Error("Unexpected payload (not an array)");
    // A store is live when any of its items had a price update within MAX_AGE_DAYS (history dates are price changes).
    const newest = {};
    for (const i of items) {
      const d = (i.priceHistory || []).map((h) => h.date).sort().pop();
      if (d && (!newest[i.store] || d > newest[i.store])) newest[i.store] = d;
    }
    const liveStores = new Set(Object.keys(STORES).filter((st) => newest[st] && (Date.now() - Date.parse(newest[st])) / 864e5 <= MAX_AGE_DAYS));
    console.log("live stores:", [...liveStores], "newest:", newest);
    const byStore = {};
    for (const i of items) {
      const id = STORES[i.store];
      if (!id || i.unavailable) continue;
      if (!liveStores.has(i.store)) continue;
      if (i.store === "billa" && BILLA_DROP.has(String(i.category))) continue;
      if (NAME_DROP.test(String(i.name))) continue;
      const price = Number(i.price);
      const name = String(i.name || "").trim();
      if (!Number.isFinite(price) || price <= 0 || !name) continue;
      (byStore[id] ||= []).push([
        String(i.id), name, Math.round(price * 100) / 100, String(i.unit || ""),
        Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : null,
        i.bio ? 1 : 0, i.isWeighted ? 1 : 0, i.category == null ? "" : String(i.category),
      ]);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const counts = {};
    for (const [id, rows] of Object.entries(byStore)) {
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      fs.writeFileSync(path.join(OUT_DIR, `${id.toLowerCase()}.json`), JSON.stringify(rows));
      counts[id] = rows.length;
    }
    if (!counts.BILLA || counts.BILLA < 1000) throw new Error("BILLA looks empty/stale: refusing to publish");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify({
      source: SOURCE_URL, license: "MIT (badlogic/heissepreise)", generatedAt: new Date().toISOString(),
      columns: ["id", "name", "priceEur", "unit", "quantity", "bio", "weighted", "category"], total, bySupermarket: counts,
    }, null, 2));
    console.log(`Wrote ${total} rows`, counts);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });

"use strict";
// Publishing rules shared by every store: validate before writing, keep the last good file.
const fs = require("node:fs");
const path = require("node:path");

const VALID_UNITS = new Set(["g", "ml", "stk"]);

/** Why [rows] must not be published, or null when they look sane. */
function problemWith(rows, { minRows }) {
  if (!Array.isArray(rows)) return "not an array";
  if (rows.length < minRows) return `only ${rows.length} rows (minimum ${minRows})`;
  const bad = rows.filter((r) => !Array.isArray(r) || r.length !== 8 || typeof r[0] !== "string" || !r[1] ||
    !(r[2] > 0 && r[2] < 1000) || !VALID_UNITS.has(r[3]) || !(r[4] > 0)).length;
  if (bad > rows.length * 0.02) return `${bad} malformed rows`;
  const ids = new Set(rows.map((r) => r[0]));
  if (ids.size !== rows.length) return `${rows.length - ids.size} duplicate ids`;
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Decides, per store, what goes into meta.json. A fresh valid result is written; otherwise the
 * previous file is kept while it is younger than maxAgeDays, so one bad day never empties a store.
 */
function publishStores(outDir, results, { now = Date.now(), maxAgeDays = 14, keepOthers = false } = {}) {
  const previous = readJson(path.join(outDir, "meta.json")) || {};
  const prevStores = previous.stores || {};
  const stores = {};
  for (const [id, r] of Object.entries(results)) {
    const file = path.join(outDir, `${id.toLowerCase()}.json`);
    const problem = r.rows ? problemWith(r.rows, r) : r.error || "no data";
    if (!problem) {
      const rows = [...r.rows].sort((a, b) => a[0].localeCompare(b[0]));
      fs.writeFileSync(file, JSON.stringify(rows));
      stores[id] = { count: rows.length, updatedAt: new Date(now).toISOString(), source: r.source };
      console.log(`${id}: published ${rows.length} rows`);
      continue;
    }
    const prev = prevStores[id] || (previous.bySupermarket?.[id] && { count: previous.bySupermarket[id], updatedAt: previous.generatedAt, source: previous.source });
    const ageDays = prev ? (now - Date.parse(prev.updatedAt)) / 864e5 : Infinity;
    if (prev && fs.existsSync(file) && ageDays <= maxAgeDays) {
      stores[id] = { ...prev, stale: true };
      console.warn(`${id}: ${problem}; keeping the file from ${prev.updatedAt}`);
    } else {
      console.warn(`${id}: ${problem}; nothing recent to keep, left out of meta.json`);
    }
  }
  // A run that only refreshes some stores (SPAR from a Mac) keeps the others as they were.
  if (keepOthers) {
    for (const [id, prev] of Object.entries(prevStores)) {
      if (id in results || id in stores) continue;
      const ageDays = (now - Date.parse(prev.updatedAt)) / 864e5;
      if (fs.existsSync(path.join(outDir, `${id.toLowerCase()}.json`)) && ageDays <= maxAgeDays) stores[id] = prev;
    }
    if (!previous.stores && previous.bySupermarket) {
      for (const [id, count] of Object.entries(previous.bySupermarket)) {
        if (!(id in stores) && fs.existsSync(path.join(outDir, `${id.toLowerCase()}.json`))) stores[id] = { count, updatedAt: previous.generatedAt, source: previous.source };
      }
    }
  }
  const bySupermarket = Object.fromEntries(Object.entries(stores).map(([id, s]) => [id, s.count]));
  const total = Object.values(bySupermarket).reduce((a, b) => a + b, 0);
  const meta = {
    source: "https://heisse-preise.io/data/latest-canonical.json",
    license: "MIT (badlogic/heissepreise) for the heisse-preise data and parsing",
    generatedAt: new Date(now).toISOString(),
    columns: ["id", "name", "priceEur", "unit", "quantity", "bio", "weighted", "category"],
    total, bySupermarket, stores,
  };
  if (total === 0) throw new Error("No store has data: refusing to publish an empty meta.json");
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

module.exports = { problemWith, publishStores };

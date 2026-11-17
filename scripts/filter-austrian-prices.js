#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCE_URL =
  process.env.HEISSE_PREISE_URL ||
  "https://heisse-preise.io/data/latest-canonical.json";
const OUTPUT_PATH = path.resolve(__dirname, "..", "prices_at.json");

// BILLA, HOFER, SPAR and LIDL only — NO PENNY.
const ALLOWED_CHAINS = new Set(["BILLA", "HOFER", "SPAR", "LIDL"]);

const TAXONOMY_KEYWORDS = [
  { id: "milk", patterns: ["vollmilch", "halbfettmilch", "haltbarmilch", "milch"] },
  { id: "butter", patterns: ["teebutter", "alpenbutter", "butter"] },
  { id: "cheese", patterns: ["gouda", "emmentaler", "bergkäse", "bergkaese", "käse", "kaese"] },
  { id: "cream", patterns: ["schlagobers", "sauerrahm", "rahm", "sahne"] },
  { id: "yogurt", patterns: ["joghurt", "naturjoghurt"] },
  { id: "egg", patterns: ["freilandeier", "bodenhaltung", "eier"] },
  { id: "bread", patterns: ["bauernbrot", "mischbrot", "toastbrot", "vollkornbrot", "brot"] },
  { id: "wheat_flour", patterns: ["weizenmehl", "mehl"] },
  { id: "pasta", patterns: ["spaghetti", "penne", "fusilli", "teigwaren", "nudeln"] },
  { id: "rice", patterns: ["basmatireis", "langkornreis", "jasminreis", "reis"] },
  { id: "oats", patterns: ["haferflocken"] },
  { id: "chicken", patterns: ["hühnerfilet", "hendl", "hähnchen", "huhn"] },
  { id: "beef", patterns: ["rindfleisch", "faschiertes rind", "rind"] },
  { id: "pork", patterns: ["schweinefleisch", "karree", "schwein"] },
  { id: "salmon", patterns: ["lachsfilet", "lachs"] },
  { id: "tuna", patterns: ["thunfisch"] },
  { id: "potato", patterns: ["erdäpfel", "erdaepfel", "kartoffel"] },
  { id: "onion", patterns: ["zwiebel"] },
  { id: "tomato", patterns: ["rispentomaten", "paradeiser", "tomaten", "tomate"] },
  { id: "apple", patterns: ["äpfel", "aepfel", "apfel"] },
  { id: "banana", patterns: ["bananen", "banane"] },
  { id: "olive_oil", patterns: ["olivenöl", "olivenoel"] },
  { id: "sugar", patterns: ["feinkristallzucker", "kristallzucker", "zucker"] },
];

function mapChain(rawStore) {
  if (!rawStore) return null;
  const upper = String(rawStore).trim().toUpperCase();
  if (upper.includes("PENNY")) return null;
  if (upper.includes("BILLA")) return "BILLA";
  if (upper.includes("HOFER")) return "HOFER";
  if (upper.includes("SPAR")) return "SPAR";
  if (upper.includes("LIDL")) return "LIDL";
  return null;
}

function matchFoodId(name) {
  const lower = String(name || "").toLowerCase();
  for (const entry of TAXONOMY_KEYWORDS) {
    if (entry.patterns.some((kw) => lower.includes(kw))) {
      return entry.id;
    }
  }
  return null;
}

function normalizeUnit(rawUnit) {
  const unit = String(rawUnit || "").trim().toLowerCase();
  if (unit === "g" || unit === "kg" || unit === "ml" || unit === "l") {
    return unit;
  }
  return "unit";
}

function filterItems(rawItems, timestamp) {
  const bestByKey = new Map();
  for (const item of rawItems) {
    const supermarketId = mapChain(item.store || item.supermarketId || item.chain);
    if (!supermarketId || !ALLOWED_CHAINS.has(supermarketId)) continue;

    const canonicalFoodId = matchFoodId(item.name || item.productName || item.canonicalFoodId);
    if (!canonicalFoodId) continue;

    const priceEur = Number(item.price ?? item.priceEur);
    if (!Number.isFinite(priceEur) || priceEur <= 0) continue;

    const unit = normalizeUnit(item.unit);
    const packageSize = Number.isFinite(Number(item.quantity ?? item.packageSize))
      ? Number(item.quantity ?? item.packageSize)
      : null;

    const key = `${supermarketId}:${canonicalFoodId}`;
    const existing = bestByKey.get(key);
    if (!existing || priceEur < existing.priceEur) {
      bestByKey.set(key, {
        supermarketId,
        canonicalFoodId,
        priceEur: Math.round(priceEur * 100) / 100,
        unit,
        packageSize,
        timestamp,
      });
    }
  }
  return Array.from(bestByKey.values());
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const rawItems = Array.isArray(payload) ? payload : payload.items || [];
  const filtered = filterItems(rawItems, Date.now());

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(filtered));
  const counts = {};
  for (const r of filtered) counts[r.supermarketId] = (counts[r.supermarketId] || 0) + 1;
  fs.writeFileSync(
    path.resolve(path.dirname(OUTPUT_PATH), "meta.json"),
    JSON.stringify({ source: SOURCE_URL, license: "MIT (badlogic/heissepreise)", generatedAt: new Date().toISOString(), total: filtered.length, bySupermarket: counts }, null, 2),
  );
  console.log(`Wrote ${filtered.length} records to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

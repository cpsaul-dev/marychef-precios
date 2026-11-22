"use strict";
// BILLA straight from the public JSON API of shop.billa.at (no token; robots.txt allows it).
// Used as a fallback when heisse-preise fails or is stale for BILLA. Category codes and parsing
// follow heisse-preise (MIT, badlogic/heissepreise stores/billa.js) so rows match what it publishes.
const { getJson, sleep } = require("./http");

const BASE = process.env.BILLA_BASE_URL || "https://shop.billa.at/api/product-discovery";

// Order matters: the category code is <index here in hex><child index in hex>, as in heisse-preise.
const BASE_CATEGORIES = [
  "obst-und-gemuese-13751", "brot-und-gebaeck-15520", "getraenke-13784", "kuehlwaren-15416", "tiefkuehl-15415",
  "vorratsschrank-15012", "suesses-und-salziges-15159", "drogerie-und-kosmetik-15274", "kueche-haushalt-und-garten-15320",
  "haustier-15672", "wurst-schinken-und-speck-15572", "baby-und-kleinkind-15671", "fisch-und-meeresfruechte-15573",
  "schnelle-kueche-15389", "neu-im-online-shop-14506", "fleisch-15571", "fleisch-wurst-und-fisch-ersatz-15215",
];
// Only food is read: drinks (wine is kept), drugstore, household, pets, baby and "new" are skipped.
const SKIP_BASE = new Set(["drogerie-und-kosmetik-15274", "kueche-haushalt-und-garten-15320", "haustier-15672", "baby-und-kleinkind-15671", "neu-im-online-shop-14506"]);
const CODE_OVERRIDES = {
  "vegan-13911": "3A", "tofu-14529": "3A", "fleisch-und-gefluegel-13921": "42", "fisch-und-meeresfruechte-13930": "43",
  "pizza-baguette-und-gebaeck-13936": "46", "pommes-frites-und-mehr-13935": "45", "tiefkuehlgerichte-13922": "42",
  "gemuese-kraeuter-und-obst-13934": "44", "eis-13917": "40", "suessspeisen-und-torten-13939": "47", "vegane-ernaehrung-14048": "5D",
};

const UNITS = {
  "stk.": ["stk", 1], stk: ["stk", 1], st: ["stk", 1], "stück": ["stk", 1], paar: ["stk", 1], blatt: ["stk", 1],
  beutel: ["stk", 1], bund: ["stk", 1], packung: ["stk", 1], pa: ["stk", 1], fl: ["stk", 1], portion: ["stk", 1], teebeutel: ["stk", 1],
  g: ["g", 1], gr: ["g", 1], gramm: ["g", 1], dag: ["g", 10], kg: ["g", 1000], kilogramm: ["g", 1000],
  ml: ["ml", 1], milliliter: ["ml", 1], dl: ["ml", 100], cl: ["ml", 10], l: ["ml", 1000], lt: ["ml", 1000], liter: ["ml", 1000],
};

/** One API product -> [id, name, priceEur, unit, quantity, bio, weighted, category], or null. */
function toRow(item, category) {
  const cents = item?.price?.regular?.value;
  if (!item?.sku || !item.name || !(cents > 0)) return null;
  const rawUnit = String(item.volumeLabelShort || item.price.baseUnitShort || "stk").toLowerCase();
  const conv = UNITS[rawUnit];
  const amount = parseFloat(String(item.amount).replace(",", "."));
  if (!conv || !(amount > 0)) return null;
  return [
    String(item.sku), String(item.name).trim(), Math.round(cents) / 100, conv[0], Math.round(amount * conv[1] * 1000) / 1000,
    (item.badges || []).includes("pp-bio") ? 1 : 0, item.weightArticle ? 1 : 0, category,
  ];
}

/** [{slug, code}] of the food sub-categories, codes as heisse-preise assigns them. */
async function foodCategories(opts = {}) {
  const out = [];
  for (const [baseIndex, base] of BASE_CATEGORIES.entries()) {
    if (SKIP_BASE.has(base)) continue;
    const children = await getJson(`${BASE}/categories/${base}/child-properties`, opts);
    if (!Array.isArray(children)) throw new Error(`Unexpected child-properties for ${base}`);
    children.forEach((c, i) => out.push({
      slug: c.slug,
      code: CODE_OVERRIDES[c.slug] ?? baseIndex.toString(16).toUpperCase() + i.toString(16).toUpperCase(),
    }));
    await sleep(opts.pauseMs ?? 1_000);
  }
  return out;
}

/** All BILLA food rows, one category at a time, 500 per page, with a pause between requests. */
async function fetchRows(opts = {}) {
  const pauseMs = opts.pauseMs ?? 1_000;
  const rows = new Map();
  for (const { slug, code } of await foodCategories(opts)) {
    for (let page = 0; page < 40; page++) {
      const data = await getJson(`${BASE}/categories/${slug}/products?pageSize=500&page=${page}`, opts);
      const results = Array.isArray(data?.results) ? data.results : [];
      for (const item of results) {
        const row = toRow(item, code);
        if (row && !rows.has(row[0])) rows.set(row[0], row);
      }
      await sleep(pauseMs);
      if (results.length < 500) break;
    }
  }
  return [...rows.values()];
}

module.exports = { fetchRows, foodCategories, toRow };

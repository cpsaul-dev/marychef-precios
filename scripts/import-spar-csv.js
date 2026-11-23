#!/usr/bin/env node
"use strict";
// Turns a SPAR price export (CSV) into data/spar.json, with the same rules as the other stores.
//   node scripts/import-spar-csv.js precios-spar-2026-11-23.csv           # writes data/spar.json + meta.json
//   DRY_RUN=1 node scripts/import-spar-csv.js precios-spar-2026-11-23.csv # only prints the counts
// Columns: fecha,mercado,productId,nombre,cantidad,precio,oferta,disponible,precio_comparacion,unidad_comparacion
// The CSV has no shop categories, so a product is kept only when it is one of the app's ingredients
// (lib/foods.js, the app's own rules), and it gets the category that rule expects.
const fs = require("node:fs");
const path = require("node:path");
const { publishStores } = require("./lib/publish");
const { isFood } = require("./filter-austrian-prices");
const { foodRule, fold } = require("./lib/foods");

const OUT_DIR = process.env.OUT_DIR || path.resolve(__dirname, "..", "data");
const COLUMNS = ["fecha", "mercado", "productId", "nombre", "cantidad", "precio", "oferta", "disponible", "precio_comparacion", "unidad_comparacion"];
const UNITS = { KG: ["g", 1000], G: ["g", 1], L: ["ml", 1000], ML: ["ml", 1], STK: ["stk", 1], ST: ["stk", 1], STUECK: ["stk", 1] };
// What the comparison price is per, in the row's own unit (g, ml or stk).
const COMPARISON = { kg: 1000, l: 1000, "stk.": 1, stk: 1 };
// Dishes, sets and party boxes: they carry an ingredient's name but are not that ingredient.
const PREPARED = /\b(mit|enjoy|restaurant|set|box|personen|party|partybroetchen|gefuellt[e]?|to go|snack|menue|bowl|fertig)\b/i;
// Where a rule's first category is not the shelf the product is on (chicken's first is fruit and veg).
const CATEGORY_OVERRIDES = { chicken: "F0", spinach: "01", strawberry: "00" };
// "Veganes Faschiertes" has the ingredient's word but is not the ingredient.
const PLANT_BASED = /vegan|veggie|vegetari|pflanzlich|plant/i;
const BIO = /\bbio\b|natur\s*\*?\s*pur/i;
// Without shop categories the name has to say what the product is. German names put it first, after
// the brand and a few adjectives: "SPAR Natur*pur Bio-Orangen" is oranges, "Fruchtriegel Banane" is not
// bananas. In a hyphenated word the last part counts ("Butter-Zopf" is a Zopf).
const BRAND = /^(spar|s-budget|despar|interspar|tann|natur\*?pur|premium|vital|asia|free|from|wie|frueher|veggie|feinstes|regional|bio)$/;
const ADJECTIVE = /^(frisch|haltbar|gruen|weiss|rot|gelb|schwarz|bunt|nativ|rein|jung|zart|fein|ganz|klein|gross|mild|extra|echt|heimisch|oesterreich|steir|kaerntn|tirol|vorarlberg|salzburg|nieder|ober|italien|griech|franzoes|spanisch|pazifisch|langkorn|rundkorn|gemahlen|geschael|getrocknet|tiefgekuehlt|natur|hartweizen|universal|glatt|griffig|doppelgriffig|kristall|staub|grob|hell|dunkel|kaltgepresst|blanchiert|gehobelt|gerieben|geschnitten|geraeuchert|vegan)/;
// Words of the name that the app's rules let through but are not the ingredient.
const NOT_THE_INGREDIENT = /leberkaese|ketchup|shake|brioche|keks|zubereitung|streichkaese|thunfischfilet|gewuerzzubereitung/;

/** The word that says what the product is, folded, or null. */
function headWord(name) {
  const words = name.replace(/\b\d+(?:[.,]\d+)?\s*(g|kg|ml|l|stk|stück)\b/gi, " ").split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && (BRAND.test(fold(words[i])) || /^[A-ZÄÖÜ*-]{2,}$/.test(words[i]))) i++;
  if (/^edition$/i.test(words[i] || "")) return null;
  while (i < words.length - 1 && ADJECTIVE.test(fold(words[i]))) i++;
  const parts = fold(words[i] || "").split(/[^a-z0-9]+/).filter((p) => p && p !== "bio");
  return parts.pop() || null;
}

const isHead = (rule, word) => !!word && rule.terms.some((t) => !t.includes(" ") && (word === t || (t.length >= 4 && word.endsWith(t))));

/** RFC 4180 rows: quoted fields may hold commas and "" quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') field += '"', i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), field = "";
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field), rows.push(row), row = [], field = "";
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f !== ""));
}

const number = (s) => parseFloat(String(s).replace(",", "."));

/** "220 G", "0,5 L", "1 STK"; when empty, a size at the end of the name ("Majoran 25g"). */
function packSize(cantidad, name) {
  const m = String(cantidad).trim().match(/^([\d.,]+)\s*([A-Za-z]+)$/) || String(name).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b\s*$/i);
  const conv = m && UNITS[m[2].toUpperCase()];
  const amount = m && number(m[1]);
  return conv && amount > 0 ? [conv[0], Math.round(amount * conv[1] * 1000) / 1000] : null;
}

/** Rows for data/spar.json plus how many were dropped and why. */
function convert(text) {
  const [header, ...lines] = parseCsv(text);
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(", ")}`);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const dropped = {};
  const drop = (why) => (dropped[why] = (dropped[why] || 0) + 1, null);
  const seen = new Set();
  let adjusted = 0;
  const rows = lines.map((f) => {
    const get = (c) => (f[col[c]] ?? "").trim();
    const id = get("productId"), name = get("nombre").replace(/\s+/g, " "), price = number(get("precio"));
    if (!id || !name || !(price > 0)) return drop("no id, name or price");
    if (seen.has(id)) return drop("repeated product");
    seen.add(id);
    if (get("oferta") === "true") return drop("promotion price, not the regular one");
    const size = packSize(get("cantidad"), name);
    if (!size) return drop("no pack size");
    let [unit, quantity] = size;
    // SPAR's own price per kg/l wins: cans are priced by drained weight and the deli counter shows
    // "1 KG" with the price of 100 g.
    const comparison = number(get("precio_comparacion")), per = COMPARISON[get("unidad_comparacion").toLowerCase()];
    if (comparison > 0 && per && Math.abs((price / quantity) * per - comparison) / comparison > 0.05) {
      quantity = Math.round((price / comparison) * per * 1000) / 1000;
      adjusted++;
    }
    if (!isFood([id, name, price, unit, quantity, 0, 0, ""]) || PREPARED.test(fold(name))) return drop("not food, or a prepared dish");
    const rule = foodRule(name, unit);
    if (!rule) return drop("not one of the app's ingredients");
    if (PLANT_BASED.test(name) && rule.food !== "tofu") return drop("plant-based version of the ingredient");
    if (!isHead(rule, headWord(name)) || NOT_THE_INGREDIENT.test(fold(name))) return drop("the ingredient is only a flavour or part of the name");
    return [id, name, Math.round(price * 100) / 100, unit, quantity, BIO.test(name) ? 1 : 0, 0, CATEGORY_OVERRIDES[rule.food] || rule.categories[0]];
  }).filter(Boolean);
  return { rows, dropped, adjusted, total: lines.length };
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node scripts/import-spar-csv.js <export.csv>");
  const { rows, dropped, adjusted, total } = convert(fs.readFileSync(file, "utf8"));
  console.log(`SPAR CSV: ${total} products, ${rows.length} kept (${adjusted} with the pack size taken from SPAR's price per kg/l)`);
  for (const [why, n] of Object.entries(dropped).sort((a, b) => b[1] - a[1])) console.log(`  dropped ${n}: ${why}`);
  if (process.env.DRY_RUN === "1") return console.log("[dry run] e.g.", JSON.stringify(rows.slice(0, 5)));
  const meta = publishStores(OUT_DIR, { SPAR: { rows, minRows: 300, source: `SPAR price export ${path.basename(file)}` } }, { keepOthers: true });
  console.log("meta:", JSON.stringify(meta.bySupermarket));
}

if (require.main === module) main();

module.exports = { convert, parseCsv, packSize, headWord };

"use strict";
// Offline tests: node --test scripts/test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { problemWith, publishStores } = require("../lib/publish");
const { isFood } = require("../filter-austrian-prices");
const billa = require("../lib/billa");
const { getJson } = require("../lib/http");

test("BILLA API products become rows like heisse-preise", () => {
  const item = { sku: "00-18500", name: "Milka Nikolo Alpenmilch", amount: "180", volumeLabelShort: "g", badges: ["eg-neu"], weightArticle: false,
    price: { baseUnitShort: "g", regular: { value: 469 } } };
  assert.deepEqual(billa.toRow(item, "58"), ["00-18500", "Milka Nikolo Alpenmilch", 4.69, "g", 180, 0, 0, "58"]);
  assert.deepEqual(billa.toRow({ ...item, amount: "1", volumeLabelShort: "l", badges: ["pp-bio"] }, "34").slice(3, 6), ["ml", 1000, 1]);
  assert.equal(billa.toRow({ ...item, price: { regular: { value: 0 } } }, "58"), null);
  assert.equal(billa.toRow({ ...item, volumeLabelShort: "wg" }, "58"), null);
});

test("retries 5xx and gives up on 4xx", async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ ok: 1 }) });
  assert.deepEqual(await getJson("u", { fetchImpl: flaky, backoffMs: 1 }), { ok: 1 });
  assert.equal(calls, 3);
  calls = 0;
  const forbidden = async () => (calls++, { ok: false, status: 403 });
  await assert.rejects(getJson("u", { fetchImpl: forbidden, backoffMs: 1 }), /403/);
  assert.equal(calls, 1);
});

test("food filter drops drinks and cleaning products", () => {
  assert.ok(isFood(["1", "Vollmilch", 1, "ml", 1000, 0, 0, "34"]));
  assert.ok(!isFood(["1", "Cola", 1, "ml", 1000, 0, 0, "20"]));
  assert.ok(!isFood(["1", "Glasreiniger", 1, "ml", 500, 0, 0, ""]));
});

const rows = (n, prefix = "") => Array.from({ length: n }, (_, i) => [`${prefix}${i}`, `P${i}`, 1.5, "g", 500, 0, 0, "34"]);

test("validation catches empty, malformed and duplicated data", () => {
  assert.equal(problemWith(rows(10), { minRows: 5 }), null);
  assert.match(problemWith(rows(3), { minRows: 5 }), /only 3/);
  assert.match(problemWith(rows(10).map((r) => [...r.slice(0, 3), "kg", ...r.slice(4)]), { minRows: 5 }), /malformed/);
  assert.match(problemWith([...rows(10), rows(1)[0]], { minRows: 5 }), /duplicate/);
});

test("a failed store keeps its last good file and the others still publish", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  const t0 = Date.parse("2026-11-20T04:00:00Z");
  publishStores(dir, { BILLA: { rows: rows(10), minRows: 5 }, SPAR: { rows: rows(8, "s"), minRows: 5 } }, { now: t0 });
  const meta = publishStores(dir, { BILLA: { rows: rows(12), minRows: 5 }, SPAR: { error: "HTTP 503", minRows: 5 } }, { now: t0 + 864e5 });
  assert.deepEqual(meta.bySupermarket, { BILLA: 12, SPAR: 8 });
  assert.equal(meta.stores.SPAR.stale, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "spar.json"))).length, 8);
  // After 14 days without a good SPAR download it is left out, so the app does not show old prices.
  const later = publishStores(dir, { BILLA: { rows: rows(12), minRows: 5 }, SPAR: { error: "HTTP 503", minRows: 5 } }, { now: t0 + 15 * 864e5 });
  assert.deepEqual(later.bySupermarket, { BILLA: 12 });
});

test("bad data never replaces good data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  const t0 = Date.parse("2026-11-20T04:00:00Z");
  publishStores(dir, { SPAR: { rows: rows(8), minRows: 5 } }, { now: t0 });
  publishStores(dir, { SPAR: { rows: rows(2), minRows: 5 } }, { now: t0 + 1000 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "spar.json"))).length, 8);
});

test("refuses to publish when no store has data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  assert.throws(() => publishStores(dir, { SPAR: { error: "x", minRows: 5 } }), /No store/);
});

test("old meta.json without per-store info still counts as previous data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  const t0 = Date.parse("2026-11-22T12:00:00Z");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ generatedAt: new Date(t0).toISOString(), bySupermarket: { BILLA: 6 } }));
  fs.writeFileSync(path.join(dir, "billa.json"), JSON.stringify(rows(6)));
  const meta = publishStores(dir, { BILLA: { error: "down", minRows: 5 }, SPAR: { rows: rows(7, "s"), minRows: 5 } }, { now: t0 + 864e5 });
  assert.deepEqual(meta.bySupermarket, { BILLA: 6, SPAR: 7 });
});

const sparCsv = require("../import-spar-csv");
const { foodRule } = require("../lib/foods");

const CSV_HEADER = "\uFEFFfecha,mercado,productId,nombre,cantidad,precio,oferta,disponible,precio_comparacion,unidad_comparacion";
const csv = (...lines) => [CSV_HEADER, ...lines].join("\n");

test("the app's ingredient rules are read as the app reads them", () => {
  assert.equal(foodRule("Woerle Gouda mild-fein", "g").food, "cheese");
  assert.equal(foodRule("SPAR Vollmilch 3,5%", "ml").food, "milk");
  assert.equal(foodRule("SPAR Kokosmilch", "ml"), null, "excluded word");
  assert.equal(foodRule("SPAR Vollmilch", "g"), null, "milk is sold by volume");
});

test("the Austrian names of the foods added in the app's #133 are matched too", () => {
  assert.equal(foodRule("SPAR Karfiol", "stk").food, "cauliflower");
  assert.equal(foodRule("SPAR Natur*pur Bio-Topfen 20%", "g").food, "quark");
  assert.equal(foodRule("SPAR Hokkaido-Kürbis", "g").food, "pumpkin");
  assert.equal(foodRule("SPAR Lauch", "g").food, "leek");
  assert.equal(foodRule("SPAR Putenschnitzel", "g").food, "turkey");
  assert.equal(foodRule("SPAR Fisolen", "g").food, "green_beans");
  assert.equal(foodRule("SPAR Zucchini", "g").food, "zucchini");
  assert.equal(foodRule("SPAR Kichererbsen", "g").food, "chickpeas", "not peas");
  assert.equal(foodRule("SPAR Knoblauch", "g").food, "garlic", "not leek");
  assert.equal(foodRule("SPAR Süßkartoffeln", "g").food, "sweet_potato", "not potato");
});

test("SPAR CSV rows become rows like the other stores", () => {
  const { rows } = sparCsv.convert(csv(
    "2026-11-23,8999,1,S-BUDGET Kartoffeln,2 KG,2.99,false,false,1.5,kg",
    '2026-11-23,8999,2,"SPAR Natur*pur Bio-Schlagobers 36% Fett","0,25 L",1.99,false,false,7.96,L',
    "2026-11-23,8999,3,SPAR Natur*pur Bio-Eier Gewichtsklasse L 10 Stück,10 STK,4.99,false,false,0.5,Stk.",
    "2026-11-23,8999,4,Kotányi Pfeffer schwarz gemahlen 42g,,3.99,false,false,,",
  ));
  assert.deepEqual(rows, [
    ["1", "S-BUDGET Kartoffeln", 2.99, "g", 2000, 0, 0, "00"],
    ["2", "SPAR Natur*pur Bio-Schlagobers 36% Fett", 1.99, "ml", 250, 1, 0, "34"],
    ["3", "SPAR Natur*pur Bio-Eier Gewichtsklasse L 10 Stück", 4.99, "stk", 10, 1, 0, "30"],
  ]);
});

test("SPAR's price per kg sets the pack size when the two disagree", () => {
  // The deli counter shows "1 KG" with the price of 100 g; cans are priced by drained weight.
  const { rows, adjusted } = sparCsv.convert(csv(
    "2026-11-23,8999,1,TANN Bauernschinken,1 KG,1.69,false,false,16.9,kg",
    "2026-11-23,8999,2,SPAR Natur*pur Bio-Tomaten geschält,400 G,0.75,false,false,3.13,kg",
  ));
  assert.deepEqual(rows.map((r) => r[4]), [100, 239.617]);
  assert.equal(adjusted, 2);
});

test("SPAR CSV keeps only the app's ingredients at their regular price", () => {
  const { rows, dropped } = sparCsv.convert(csv(
    "2026-11-23,8999,1,SPAR Vollmilch,1 L,1.49,true,false,1.49,L",
    "2026-11-23,8999,2,SPAR enjoy Halbbaguette mit Schinken & Käse,220 G,2.99,false,false,13.59,kg",
    "2026-11-23,8999,3,Nussyy Bio Fruchtriegel Banane Mandel,40 G,1.29,false,false,32.25,kg",
    "2026-11-23,8999,4,SPAR Veggie veganes Faschiertes,275 G,4.99,false,false,18.15,kg",
    "2026-11-23,8999,5,SPAR Glasreiniger,500 ML,1.99,false,false,3.98,L",
    "2026-11-23,8999,6,SPAR Cola,1 L,1.29,false,false,1.29,L",
    "2026-11-23,8999,7,INTERSPAR Restaurant Schnitzelbox,,38.99,false,false,,",
    "2026-11-23,8999,8,S-BUDGET Leberkäse per Packung,300 G,2.49,false,false,8.3,kg",
  ));
  assert.deepEqual(rows, []);
  assert.deepEqual(dropped, {
    "promotion price, not the regular one": 1,
    "not food, or a prepared dish": 2,
    "the ingredient is only a flavour or part of the name": 2,
    "plant-based version of the ingredient": 1,
    "not one of the app's ingredients": 1,
    "no pack size": 1,
  });
});

test("a SPAR CSV without the expected columns is refused", () => {
  assert.throws(() => sparCsv.convert("id,name,price\n1,Milch,1.49"), /missing columns: fecha/);
});

test("a SPAR-only run keeps BILLA as it was", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  const t0 = Date.parse("2026-11-22T04:00:00Z");
  publishStores(dir, { BILLA: { rows: rows(10), minRows: 5 } }, { now: t0 });
  const meta = publishStores(dir, { SPAR: { rows: rows(6, "s"), minRows: 5 } }, { now: t0 + 3600e3, keepOthers: true });
  assert.deepEqual(meta.bySupermarket, { SPAR: 6, BILLA: 10 });
  assert.equal(meta.stores.BILLA.updatedAt, new Date(t0).toISOString());
});

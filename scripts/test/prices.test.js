"use strict";
// Offline tests: node --test scripts/test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const spar = require("../lib/spar");
const { problemWith, publishStores } = require("../lib/publish");
const { isFood } = require("../filter-austrian-prices");

const hit = (mv) => ({ masterValues: { "product-number": "123", title: "SPAR", "short-description": "Vollmilch", price: 1.59, ...mv } });

test("parses a packed product with its size text", () => {
  const row = spar.toRow(hit({ "short-description-3": "1 Liter", "price-per-unit": "1,59 €/L", "category-path": [["F2", "F2-1", "F2-1-1"]] }));
  assert.deepEqual(row, ["123", "SPAR Vollmilch", 1.59, "ml", 1000, 0, 0, "34"]);
});

test("parses multipacks, grams and bio", () => {
  const row = spar.toRow(hit({ "short-description-3": "6x0,5 l", biolevel: "Bio" }));
  assert.equal(row[3], "ml");
  assert.equal(row[4], 3000);
  assert.equal(row[5], 1);
  assert.deepEqual(spar.toRow(hit({ "short-description-3": "500 g" })).slice(3, 5), ["g", 500]);
});

test("weighted products use the unit price", () => {
  const row = spar.toRow(hit({ price: 2.5, "item-type": "WeightProduct", "price-per-unit": "9,99 €/KG", "short-description-3": "ca. 250 g" }));
  assert.equal(row[3], "g");
  assert.equal(row[6], 1);
  assert.ok(Math.abs(row[4] - 250.25) < 1);
});

test("falls back to the unit price when the size text is unknown", () => {
  const row = spar.toRow(hit({ price: 2, "short-description-3": "1 Packung", "price-per-unit": "4,00 €/KG" }));
  assert.deepEqual(row.slice(3, 5), ["g", 500]);
});

test("rejects hits without id, name or price", () => {
  assert.equal(spar.toRow({}), null);
  assert.equal(spar.toRow(hit({ price: 0 })), null);
  assert.equal(spar.toRow(hit({ "product-number": undefined, "code-internal": undefined })), null);
});

test("category falls back to the closest known parent", () => {
  assert.equal(spar.categoryOf([["F2-1-1-99"]]), "34");
  assert.equal(spar.categoryOf(["F99-1"]), "");
  assert.equal(spar.categoryOf(undefined), "");
});

test("hits are found in both payload shapes", () => {
  assert.equal(spar.hitsOf({ hits: [1, 2] }).length, 2);
  assert.equal(spar.hitsOf({ hits: { hits: [1] } }).length, 1);
  assert.equal(spar.hitsOf({}), null);
});

test("retries 5xx and gives up on 4xx", async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ hits: [] }) });
  assert.deepEqual(await spar.getJson("u", { fetchImpl: flaky, backoffMs: 1 }), { hits: [] });
  assert.equal(calls, 3);
  calls = 0;
  const forbidden = async () => (calls++, { ok: false, status: 403 });
  await assert.rejects(spar.getJson("u", { fetchImpl: forbidden, backoffMs: 1 }), /403/);
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

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

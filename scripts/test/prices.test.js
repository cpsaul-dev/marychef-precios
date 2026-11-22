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

const spar = require("../lib/spar");

/** A product page as spar.at serves it: a flat Nuxt payload where every value is an index. */
function sparPage({ id = "1456905", path = "lebensmittel|milchprodukte-alternativen|kaese-streichkaese-frischkaese|schnittkaese", unit = "KG", amount = "0,250", statt = null, base = 3.99 } = {}) {
  const arr = [];
  const put = (v) => arr.push(v) - 1;
  const obj = (o) => {
    const i = put(null);
    arr[i] = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" && "ref" in v ? v.ref : put(v)]));
    return i;
  };
  const ref = (i) => ({ ref: i });
  put(["ShallowReactive", 1]);
  const root = put(null);
  const reactive = put(null);
  const val = (v) => obj({ valueString: v });
  const attrs = obj({
    amount: ref(obj({ values: ref(put([val(amount)])) })),
    unit: ref(obj({ values: ref(put([val(unit)])) })),
    organic: ref(obj({ values: ref(put([obj({ valueBoolean: false })])) })),
  });
  const product = obj({ name1: "Woerle", name2: "Gouda mild-fein", pwCategoryPathIDs: path, classificationStoreAttribute: ref(attrs) });
  const price = obj({ basePrice: base, calculatedPrice: base, stattPrice: statt });
  const data = obj({ [`pdp-${id}`]: ref(product), [`pdp-price-${id}-8999`]: ref(price) });
  arr[reactive] = ["ShallowReactive", data];
  arr[root] = { data: reactive };
  return `<html><script type="application/json" id="__NUXT_DATA__" data-ssr="true">${JSON.stringify(arr)}</script></html>`;
}

test("SPAR product page becomes a row", () => {
  assert.deepEqual(spar.rowFromPage(sparPage()), ["1456905", "Woerle Gouda mild-fein", 3.99, "g", 250, 0, 0, "32"]);
  assert.equal(spar.rowFromPage(sparPage({ statt: 4.49, base: 3.49 }))[2], 4.49, "regular price, not the promotion");
  assert.deepEqual(spar.rowFromPage(sparPage({ unit: "L", amount: "1" })).slice(3, 5), ["ml", 1000]);
});

test("SPAR non-food and ready meals are dropped", () => {
  assert.equal(spar.rowFromPage(sparPage({ path: "drogerie-beauty|koerper-gesicht|fusspflege|fusspflaster-tinkturen" })), null);
  assert.equal(spar.rowFromPage(sparPage({ path: "drogerie-beauty|gesundheit|nahrungsergaenzung|protein-sportnahrung" })), null);
  assert.equal(spar.rowFromPage(sparPage({ path: "lebensmittel|schnelle-kueche-to-go|fertiggerichte|fertigmahlzeiten" })), null);
  assert.equal(spar.rowFromPage(sparPage({ path: "getraenke|alkoholfreie-getraenke|limonaden|cola" })), null);
  assert.equal(spar.categoryCode("lebensmittel|beilagen-essig-oel-gewuerze|beilagen|nudeln-teigwaren"), "54");
  assert.equal(spar.categoryCode("lebensmittel|beilagen-essig-oel-gewuerze|essig-oel|speiseoel"), "5C");
});

test("only SPAR URLs with an ingredient word are read", () => {
  const xml = ["woerle-gouda-mild-fein-p1456905", "hp-druckerpatrone-304-schwarz-p2020001353613", "spar-vollmilch-3-5-p1234567"]
    .map((s) => `<url><loc>https://www.spar.at/produktwelt/${s}</loc></url>`).join("");
  assert.deepEqual(spar.candidateUrls(xml).map((u) => u.split("/").pop()), ["woerle-gouda-mild-fein-p1456905", "spar-vollmilch-3-5-p1234567"]);
});

test("a SPAR-only run keeps BILLA as it was", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "precios-"));
  const t0 = Date.parse("2026-11-22T04:00:00Z");
  publishStores(dir, { BILLA: { rows: rows(10), minRows: 5 } }, { now: t0 });
  const meta = publishStores(dir, { SPAR: { rows: rows(6, "s"), minRows: 5 } }, { now: t0 + 3600e3, keepOthers: true });
  assert.deepEqual(meta.bySupermarket, { SPAR: 6, BILLA: 10 });
  assert.equal(meta.stores.BILLA.updatedAt, new Date(t0).toISOString());
});

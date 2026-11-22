"use strict";
// SPAR products straight from the product search that interspar.at uses (FactFinder).
// Parsing follows heisse-preise (MIT, badlogic/heissepreise stores/spar.js), which stopped updating SPAR.
// Every network step has a timeout, retries with backoff, and a polite pause between pages.

const CATEGORY_CODES = require("./spar-categories.json"); // SPAR category id (F2-1-1) -> heisse-preise code (34)

const SEARCH_URL = process.env.SPAR_SEARCH_URL || "https://search-spar.spar-ics.com/fact-finder/rest/v4/search/products_lmos_at";
const USER_AGENT = "marychef-precios/1.0 (+https://github.com/cpsaul-dev/marychef-precios; weekly personal price snapshot)";

const UNITS = {
  "stk.": ["stk", 1], stk: ["stk", 1], st: ["stk", 1], "stück": ["stk", 1], paar: ["stk", 1], blatt: ["stk", 1], teebeutel: ["stk", 1],
  g: ["g", 1], gr: ["g", 1], gramm: ["g", 1], dag: ["g", 10], kg: ["g", 1000], kilogramm: ["g", 1000],
  ml: ["ml", 1], milliliter: ["ml", 1], dl: ["ml", 100], cl: ["ml", 10], l: ["ml", 1000], lt: ["ml", 1000], liter: ["ml", 1000],
  "100g": ["g", 100], "100ml": ["ml", 100],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET json with a timeout and retries (network errors, 429 and 5xx). Other 4xx fail at once. */
async function getJson(url, { retries = 3, timeoutMs = 90_000, fetchImpl = fetch, backoffMs = 5_000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 3 ** (attempt - 1));
    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json", "accept-language": "de-AT,de;q=0.9" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.fatal = true;
        throw e;
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      console.warn(`SPAR: attempt ${attempt + 1} failed for ${url}: ${e.message}`);
      if (e.fatal) break;
    }
  }
  throw lastError;
}

function hitsOf(payload) {
  const h = payload && payload.hits;
  if (Array.isArray(h)) return h;
  if (h && Array.isArray(h.hits)) return h.hits;
  return null;
}

function searchUrl(page, hitsPerPage) {
  return `${SEARCH_URL}?query=*&q=*&page=${page}&hitsPerPage=${hitsPerPage}`;
}

/**
 * The whole SPAR catalog. First one big request (lightest for the server, as heisse-preise does);
 * if that fails or looks cut, page through it in small pages with a pause between them.
 */
async function fetchCatalog(opts = {}) {
  const { pageSize = 500, maxPages = 200, pauseMs = 1_500, minItems = 1_000 } = opts;
  try {
    const hits = hitsOf(await getJson(searchUrl(1, 32_000), opts));
    if (hits && hits.length >= minItems) return hits;
    console.warn(`SPAR: single request gave ${hits ? hits.length : "no"} hits, paging instead`);
  } catch (e) {
    console.warn(`SPAR: single request failed (${e.message}), paging instead`);
  }
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const payload = await getJson(searchUrl(page, pageSize), opts);
    const hits = hitsOf(payload) || [];
    all.push(...hits);
    const pageCount = Number(payload?.paging?.pageCount);
    if (hits.length < pageSize || (Number.isFinite(pageCount) && page >= pageCount)) break;
    await sleep(pauseMs);
  }
  return all;
}

/** [quantity, unit] from the end of a text like "1 Liter", "500 g", "6x0,5 l". */
function quantityAtEnd(text) {
  if (!text) return [undefined, undefined];
  const tokens = String(text).trim().replace(/[()]/g, "").replace(/,/g, ".").split(/\s+/);
  const last = tokens[tokens.length - 1];
  const token = parseFloat(last) ? last : (tokens.length >= 2 ? tokens[tokens.length - 2] : "") + last;
  const m = token.match(/^([0-9.x]+)(.*)$/);
  if (!m) return [undefined, undefined];
  let quantity = 1;
  for (const q of m[1].split("x")) quantity *= parseFloat(q);
  return [quantity, m[2].toLowerCase()];
}

function euro(text) {
  const n = parseFloat(String(text).replace("€", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : undefined;
}

/** The heisse-preise category code of a product, from its most specific known SPAR category. */
function categoryOf(paths) {
  if (!Array.isArray(paths)) return "";
  const candidates = paths.flat().map(String).filter((p) => /^F(\d+)(-\d+)*$/.test(p) && Number(p.slice(1).split("-")[0]) <= 13);
  candidates.sort((a, b) => b.length - a.length);
  for (const p of candidates) {
    const parts = p.split("-");
    for (let i = parts.length; i > 0; i--) {
      const code = CATEGORY_CODES[parts.slice(0, i).join("-")];
      if (code) return code;
    }
  }
  return "";
}

/** One SPAR hit -> one row [id, name, priceEur, unit, quantity, bio, weighted, category], or null. */
function toRow(hit) {
  const v = hit && hit.masterValues;
  if (!v) return null;
  const id = v["product-number"] ?? v["code-internal"];
  const name = [v.title, v["short-description"] ?? v.name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  let price = euro(v.price);
  if (v["quantity-selector"] && v["price-per-unit"]) price = euro(String(v["price-per-unit"]).split("/")[0]);
  if (!id || !name || !price || price <= 0) return null;

  let quantity, unit;
  const description = v["short-description-3"] ?? v["short-description-2"];
  if (description) {
    [quantity, unit] = quantityAtEnd(String(description).replace(" EINWEG", "").replace(" MEHRWEG", "").replace("per kg", "1 kg").trim());
  } else {
    const d = String(v["short-description"] ?? v.name ?? "").toLowerCase();
    [quantity, unit] = d.endsWith("per kg") || d.endsWith("im topf") ? [1, "kg"] : [1, "stk."];
  }
  // Fallback from the unit price ("3,98 €/KG"): quantity = price / unit price.
  let fallback = null;
  if (v["price-per-unit"]) {
    const [up, u] = String(v["price-per-unit"]).split("/");
    const unitPrice = euro(up);
    if (unitPrice && u) fallback = [Number((price / unitPrice).toFixed(3)), u.trim().toLowerCase()];
  }
  const weighted = v["item-type"] === "WeightProduct";
  if (weighted && fallback) [quantity, unit] = fallback;
  let conv = UNITS[unit];
  if ((!conv || !Number.isFinite(quantity)) && fallback) {
    [quantity, unit] = fallback;
    conv = UNITS[unit];
  }
  if (!conv || !Number.isFinite(quantity) || quantity <= 0) return null;
  return [
    String(id), name, Math.round(price * 100) / 100, conv[0], Math.round(quantity * conv[1] * 1000) / 1000,
    v.biolevel === "Bio" ? 1 : 0, weighted ? 1 : 0, categoryOf(v["category-path"]),
  ];
}

module.exports = { fetchCatalog, getJson, hitsOf, toRow, categoryOf, quantityAtEnd, USER_AGENT };

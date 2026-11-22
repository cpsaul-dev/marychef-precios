"use strict";
// SPAR from its public Produktwelt pages (spar.at/produktwelt). robots.txt allows them; no token,
// no private API. Only pages whose name looks like a MaryChef ingredient are read, one per second.
// Only the HTML is downloaded (compressed, about 43 KB a page): no images, scripts or styles.
// spar.at answers 403 to GitHub's servers, so this runs on a normal connection (see README).

const BASE = "https://www.spar.at";
const SITEMAP = `${BASE}/index.sitemap.produktwelt-sitemap.xml`;
const OUTLET = "8999"; // national prices, as the site shows before a store is chosen
const USER_AGENT = "marychef-precios/1.0 (+https://github.com/cpsaul-dev/marychef-precios; weekly personal price snapshot)";

// Words of MaryChef's ingredients (core/pricing/ProductMatcher.kt), as they appear in SPAR's URLs
// (ä→ae, ö→oe, ü→ue, ß→ss). A URL is read when one of its words starts or ends with one of these.
const TERMS = [
  "mehl", "brot", "spaghetti", "penne", "fusilli", "nudeln", "spiralen", "farfalle", "maccheroni", "rigatoni", "tagliatelle",
  "linguine", "haferflocken", "couscous", "reis", "basmati", "jasminreis", "risotto", "milch", "butter", "gouda", "emmentaler",
  "edamer", "bergkaese", "parmesan", "parmigiano", "grana", "mozzarella", "cheddar", "tilsiter", "kaese", "schlagobers", "obers",
  "sahne", "kochcreme", "joghurt", "jogurt", "eier", "hendl", "huhn", "haehnchen", "huehner", "putenbrust", "rindfleisch",
  "rind", "faschiertes", "beiried", "rumpsteak", "tafelspitz", "gulaschfleisch", "schwein", "karree", "schopf", "bauchfleisch",
  "speck", "schinken", "prosciutto", "lachs", "thunfisch", "dorsch", "kabeljau", "seelachs", "seehecht", "fischfilet",
  "garnelen", "shrimps", "crevetten", "gambas", "muscheln", "tintenfisch", "calamari", "oktopus", "pulpo", "tofu", "kartoffel",
  "erdaepfel", "zwiebel", "knoblauch", "tomaten", "paradeiser", "karotten", "karotte", "moehren", "paprika", "zucchini",
  "kuerbis", "melanzani", "aubergine", "spinat", "brokkoli", "broccoli", "champignon", "pilze", "austernpilze", "sellerie",
  "linsen", "kichererbsen", "bohnen", "kidney", "avocado", "zitrone", "zitronen", "aepfel", "apfel", "bananen", "banane",
  "erdbeeren", "orangen", "mandeln", "mandel", "walnuss", "walnuesse", "haselnuss", "haselnuesse", "erdnuss", "erdnuesse",
  "olivenoel", "sonnenblumenoel", "rapsoel", "sojasauce", "senf", "sesam", "tahin", "veltliner", "weisswein", "chardonnay",
  "riesling", "sauvignon", "rotwein", "zweigelt", "essig", "balsamico", "zucker", "honig", "salz", "meersalz", "pfeffer",
  "zartbitter", "kochschokolade", "backschokolade",
];

// SPAR category path ("lebensmittel|milchprodukte-alternativen|...") -> heisse-preise category code,
// the codes ProductMatcher's rules use. First match wins; no match means "not an ingredient shelf".
const CATEGORY_CODES = [
  [/\|obst-gemuese\|.*salat/, "02"], [/\|obst-gemuese\|.*(kraeuter|knoblauch)/, "03"], [/\|obst-gemuese\|.*pilze/, "04"],
  [/\|obst-gemuese\|.*(gemuese|kartoffel|zwiebel)/, "01"], [/\|obst-gemuese\|/, "00"],
  [/\|brot-gebaeck\|.*toast/, "10"], [/\|brot-gebaeck\|(?!.*(trockenbrot|knaecke|zwieback|kuchen|suess))/, "11"],
  [/\|milchprodukte-alternativen\|.*eier/, "30"], [/\|milchprodukte-alternativen\|.*kaese/, "32"],
  [/\|milchprodukte-alternativen\|.*butter/, "32"], [/\|milchprodukte-alternativen\|/, "34"],
  [/\|eier/, "30"], [/\|fisch/, "41"], [/tiefkuehl.*fisch/, "41"], [/tiefkuehl.*gemuese/, "40"],
  [/\|fleisch.*(gefluegel|huhn|hendl|pute)/, "F0"], [/\|fleisch.*schwein/, "F2"], [/\|fleisch.*(rind|kalb|faschiert)/, "F1"],
  [/\|fleisch/, "F1"], [/\|(wurst|schinken|aufschnitt|speck)/, "A6"], [/tofu|fleischersatz/, "100"],
  [/\|beilagen\|/, "54"], [/\|essig-oel\|/, "5C"], [/\|gewuerze.*salz/, "5B"], [/\|(gewuerze|saucen|wuerz|senf)/, "5C"],
  [/\|backen\|.*zucker/, "52"], [/\|backen\|.*(mehl|griess)/, "57"], [/\|fruehstueck\|.*(honig|aufstrich|marmelade)/, "51"],
  [/\|fruehstueck\|/, "59"], [/(konserven|eingelegt)/, "53"], [/(nuesse|trockenfruechte|kerne)/, "5D"],
  [/\|suesses\|.*schokolade/, "58"], [/\|backen\|.*schokolade/, "58"], [/^getraenke\|.*wein(?!.*(sekt|schaum|spritzer))/, "25"],
];

const UNITS = { KG: ["g", 1000], G: ["g", 1], L: ["ml", 1000], ML: ["ml", 1], STK: ["stk", 1], ST: ["stk", 1], STUECK: ["stk", 1], PCE: ["stk", 1] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url, { retries = 3, timeoutMs = 60_000, fetchImpl = fetch, backoffMs = 10_000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 3 ** (attempt - 1));
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, "accept-language": "de-AT,de;q=0.9", "accept-encoding": "gzip, br", accept: "text/html" }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        e.fatal = true;
        throw e;
      }
      return await res.text();
    } catch (e) {
      last = e;
      if (e.fatal) break;
    }
  }
  throw last;
}

/** Product URLs of the sitemap whose name has an ingredient word. */
function candidateUrls(sitemapXml) {
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /-p\d{5,}$/.test(u));
  return urls.filter((u) => {
    const words = u.split("/").pop().replace(/-p\d+$/, "").split("-");
    return words.some((w) => TERMS.some((t) => w === t || (w.length > t.length && (w.startsWith(t) || w.endsWith(t)))));
  });
}

/** The page's Nuxt payload as plain objects. */
function nuxtData(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const arr = JSON.parse(m[1]);
  const seen = new Map();
  const deref = (i, depth = 0) => {
    if (typeof i !== "number" || depth > 40) return i;
    if (seen.has(i)) return seen.get(i);
    const v = arr[i];
    let out = v;
    if (Array.isArray(v)) {
      if (v[0] === "ShallowReactive" || v[0] === "Reactive" || v[0] === "Ref" || v[0] === "ShallowRef") return deref(v[1], depth + 1);
      out = [];
      seen.set(i, out);
      for (const e of v) out.push(deref(e, depth + 1));
      return out;
    }
    if (v && typeof v === "object") {
      out = {};
      seen.set(i, out);
      for (const [k, e] of Object.entries(v)) out[k] = deref(e, depth + 1);
      return out;
    }
    return v;
  };
  return deref(1)?.data ?? null;
}

const first = (attr) => attr?.values?.[0]?.valueString ?? attr?.values?.[0]?.valueBoolean;

function categoryCode(path) {
  const p = String(path || "");
  if (!/^(lebensmittel|getraenke)\|/.test(p)) return "";
  if (p.startsWith("getraenke|") && !/wein/.test(p)) return "";
  for (const [re, code] of CATEGORY_CODES) if (re.test(p)) return code;
  return "";
}

/** One product page -> [id, name, priceEur, unit, quantity, bio, weighted, category], or null. */
function rowFromPage(html) {
  const data = nuxtData(html);
  if (!data) return null;
  const productKey = Object.keys(data).find((k) => /^pdp-\d+$/.test(k));
  if (!productKey) return null;
  const id = productKey.slice(4);
  const product = data[productKey];
  const price = data[`pdp-price-${id}-${OUTLET}`] || data[Object.keys(data).find((k) => k.startsWith(`pdp-price-${id}-`))];
  const regular = Number(price?.stattPrice ?? price?.basePrice ?? price?.calculatedPrice);
  const name = [product?.name1, product?.name2].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const attrs = product?.classificationStoreAttribute || {};
  const amount = parseFloat(String(first(attrs.amount) ?? "").replace(",", "."));
  const conv = UNITS[String(first(attrs.unit) ?? "").toUpperCase()];
  const paths = product?.pwCategoryPathIDs;
  const path = Array.isArray(paths) ? paths.flat().find((p) => /^(lebensmittel|getraenke)\|/.test(String(p))) : paths;
  const category = categoryCode(path);
  if (!name || !(regular > 0) || !conv || !(amount > 0) || !category) return null;
  return [id, name, Math.round(regular * 100) / 100, conv[0], Math.round(amount * conv[1] * 1000) / 1000,
    first(attrs.organic) === true ? 1 : 0, 0, category];
}

/** Reads the candidate pages one by one. Stops early when the site starts refusing. */
async function fetchRows({ pauseMs = 1_000, maxPages = Infinity, log = console.log } = {}) {
  const urls = candidateUrls(await getText(SITEMAP)).slice(0, maxPages);
  log(`SPAR: ${urls.length} candidate pages`);
  const rows = new Map();
  let failures = 0;
  for (const [i, url] of urls.entries()) {
    try {
      const row = rowFromPage(await getText(url));
      if (row) rows.set(row[0], row);
      failures = 0;
    } catch (e) {
      if (e.status === 403 || ++failures >= 10) throw new Error(`SPAR stopped answering at page ${i + 1}: ${e.message}`);
    }
    if ((i + 1) % 100 === 0) log(`SPAR: ${i + 1}/${urls.length} pages, ${rows.size} rows`);
    await sleep(pauseMs);
  }
  return [...rows.values()];
}

module.exports = { fetchRows, candidateUrls, rowFromPage, categoryCode, nuxtData, getText };

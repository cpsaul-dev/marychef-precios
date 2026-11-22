// Temporary: finds out how interspar.at loads product prices now. Prints status and a slice of each answer.
const UA = "marychef-precios/1.0 (+https://github.com/cpsaul-dev/marychef-precios)";
const B = "https://search-spar.spar-ics.com/fact-finder/rest";
const urls = [
  `${B}/v4/search/products_lmos_at?query=milch&hitsPerPage=2`,
  `${B}/v4/search/products_lmos_at?query=*&hitsPerPage=2`,
  `${B}/v4/search/products_lmos_at?query=*&q=*&page=1&hitsPerPage=2`,
  `${B}/v5/search/products_lmos_at?query=milch&hitsPerPage=2`,
  `${B}/v4/search/products_lmos_at?query=milch&page=1&hitsPerPage=2&channel=products_lmos_at`,
  "https://www.interspar.at/shop/lebensmittel/search/?q=milch",
  "https://www.interspar.at/shop/lebensmittel/",
  "https://www.spar.at/produktwelt",
  "https://www.spar.at/",
];
(async () => {
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json, text/html" }, signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      console.log(`\n=== ${r.status} ${u} (${t.length} chars, ${r.headers.get("content-type")})`);
      if (t.trim().startsWith("{") || t.trim().startsWith("[")) console.log(t.slice(0, 2500));
      else {
        const hints = new Set();
        for (const m of t.matchAll(/https?:\/\/[a-z0-9.-]*(?:spar|factfinder|fact-finder|api|search)[a-z0-9.-]*[^"'\s<>)]{0,120}/gi)) hints.add(m[0]);
        for (const m of t.matchAll(/["'](\/[a-z0-9/_-]*(?:api|search|graphql|product)[a-z0-9/_?=&.-]*)["']/gi)) hints.add(m[1]);
        console.log([...hints].slice(0, 60).join("\n"));
        const price = t.match(/.{0,200}€.{0,200}/);
        if (price) console.log("PRICE SNIPPET:", price[0].replace(/\s+/g, " "));
        for (const id of ["__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "window.__"]) if (t.includes(id)) console.log("has", id);
      }
      await new Promise((s) => setTimeout(s, 1500));
    } catch (e) {
      console.log(`\n=== ERR ${u}: ${e.message}`);
    }
  }
})();

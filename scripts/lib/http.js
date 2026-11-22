"use strict";
const USER_AGENT = "marychef-precios/1.0 (+https://github.com/cpsaul-dev/marychef-precios; daily personal price snapshot)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET json with a timeout and retries on network errors, 429 and 5xx. Other 4xx fail at once. */
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
      console.warn(`attempt ${attempt + 1} failed for ${url}: ${e.message}`);
      if (e.fatal) break;
    }
  }
  throw lastError;
}

module.exports = { getJson, sleep, USER_AGENT };

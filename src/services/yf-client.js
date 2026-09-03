/**
 * Yahoo Finance access.
 *
 * PRIMARY PATH — chartQuote():
 *   Hits the public /v8/finance/chart endpoint directly with axios. This
 *   endpoint needs NO cookie/crumb, so it is not affected by the
 *   "Failed to get crumb, status 429, Too Many Requests" blocks Yahoo applies
 *   to datacenter IPs (Render, AWS, etc.). Use this everywhere.
 *
 * LEGACY — yf (yahoo-finance2 instance):
 *   Kept only so nothing breaks if some caller still needs quoteSummary etc.
 *   Its quote()/quoteSummary() calls require a crumb and DO get 429'd on Render.
 */
const axios = require("axios");
const YahooFinance = require("yahoo-finance2").default;

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Both hosts serve the same data; we alternate on retry in case one IP-blocks us.
const CHART_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

// A real browser UA + language make the anonymous chart endpoint far less
// likely to answer 429/999 from a shared datacenter IP.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Retries an async function when Yahoo Finance returns 429 Too Many Requests.
 * (Legacy helper — kept for callers still using the yf instance.)
 */
async function fetchWithRetry(fn, maxRetries = 3, baseDelay = 3000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const is429 =
        err.message &&
        (err.message.includes("429") || err.message.includes("Too Many"));
      if (is429 && attempt < maxRetries) {
        const delay = baseDelay * attempt; // 3 s, 6 s
        console.warn(
          `[yf-client] 429 on attempt ${attempt}/${maxRetries} — retrying in ${delay / 1000}s`
        );
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Fetch a single quote via the crumb-free chart endpoint.
 *
 * Alternates query1 -> query2 and backs off on 429 / 999 / 5xx / network errors.
 *
 * @param {string} symbol           e.g. "NIFTYBEES.NS"
 * @param {object} [opts]
 * @param {number} [opts.retries=4]
 * @param {number} [opts.baseDelay=2000]  ms; grows linearly per attempt
 * @returns {Promise<{symbol:string, price:number, prevClose:number,
 *                     changePct:number, marketTime:(Date|null)}>}
 */
async function chartQuote(symbol, { retries = 4, baseDelay = 2000 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const host = CHART_HOSTS[(attempt - 1) % CHART_HOSTS.length];
    try {
      // range MUST be "1d": chartPreviousClose is "the close immediately before
      // the first bar in the returned window", so with range=1d it is the PRIOR
      // TRADING DAY's close — exactly the reference the dip strategy needs.
      // With range=5d it was the close ~5 sessions back, turning changePct into
      // a stale multi-day move (a +2% up-day was reported as -3.5% → false BUY).
      const res = await axios.get(
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}`,
        {
          params: { range: "1d", interval: "1d" },
          headers: BROWSER_HEADERS,
          timeout: 15000,
        }
      );

      const result = res.data && res.data.chart && res.data.chart.result;
      const meta = result && result[0] && result[0].meta;
      if (!meta || meta.regularMarketPrice == null) {
        throw new Error(`chart endpoint returned no price for ${symbol}`);
      }

      const price = meta.regularMarketPrice;

      // previousClose is the unambiguous field but is often absent for .NS
      // symbols; chartPreviousClose (with range=1d) is the same value.
      let prevClose =
        meta.previousClose != null
          ? meta.previousClose
          : meta.chartPreviousClose;
      if (!(prevClose > 0)) prevClose = price; // last-resort: report a flat day

      const changePct = ((price - prevClose) / prevClose) * 100;

      return {
        symbol: meta.symbol || symbol,
        price,
        prevClose,
        changePct: Number(changePct.toFixed(2)),
        marketTime: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000)
          : null,
      };
    } catch (err) {
      lastErr = err;
      const status = err.response && err.response.status;
      const retryable =
        status === 429 || status === 999 || status === 503 || !status;

      if (retryable && attempt < retries) {
        const delay = baseDelay * attempt; // 2s, 4s, 6s
        console.warn(
          `[yf-client] chart ${symbol} attempt ${attempt}/${retries} failed ` +
            `(${status || err.code || err.message}) — retry in ${delay / 1000}s`
        );
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  throw lastErr;
}

module.exports = { yf, sleep, fetchWithRetry, chartQuote };

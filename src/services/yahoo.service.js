const { yf, fetchWithRetry } = require("./yf-client");
const { log, error } = require("../utils/logger");

async function fetchETF(symbol) {
  try {
    const q = await fetchWithRetry(() => yf.quote(symbol));

    const changePct =
      ((q.regularMarketPrice - q.regularMarketPreviousClose) /
        q.regularMarketPreviousClose) *
      100;

    log(
      "Fetched " + symbol + ": Rs." + q.regularMarketPrice + " (" + changePct.toFixed(2) + "%)",
    );

    return {
      price: q.regularMarketPrice,
      changePct: Number(changePct.toFixed(2)),
    };
  } catch (err) {
    error("Yahoo fetch failed for " + symbol, err.message);
    throw err;
  }
}

/**
 * Batch quote for multiple symbols in ONE request.
 *
 * yahoo-finance2 accepts an array and returns one HTTP call, so this avoids
 * the per-symbol 1.5 s pacing the market scan needs — safe to call on demand
 * from the Telegram listener.
 *
 * @param {string[]} symbols  e.g. ["NIFTYBEES.NS", "GOLDBEES.NS"]
 * @returns {Promise<Object>} { [symbol]: { price, changePct } }
 */
async function fetchETFs(symbols) {
  try {
    const list = await fetchWithRetry(() => yf.quote(symbols));
    const arr = Array.isArray(list) ? list : [list];

    const out = {};
    for (const q of arr) {
      const prev = q.regularMarketPreviousClose;
      const changePct = prev
        ? ((q.regularMarketPrice - prev) / prev) * 100
        : 0;
      out[q.symbol] = {
        price: q.regularMarketPrice,
        changePct: Number(changePct.toFixed(2)),
      };
    }
    return out;
  } catch (err) {
    error("Yahoo batch fetch failed", err.message);
    throw err;
  }
}

module.exports = { fetchETF, fetchETFs };

const { chartQuote, sleep } = require("./yf-client");
const { log, error } = require("../utils/logger");

async function fetchETF(symbol) {
  try {
    const q = await chartQuote(symbol);

    log(
      "Fetched " + symbol + ": Rs." + q.price + " (" + q.changePct.toFixed(2) + "%)",
    );

    return {
      price: q.price,
      changePct: q.changePct,
    };
  } catch (err) {
    error("Yahoo fetch failed for " + symbol, err.message);
    throw err;
  }
}

/**
 * Quotes for many symbols.
 *
 * The crumb-free chart endpoint is one request per symbol, but it is cheap and
 * not rate-limited like the crumb path — a short stagger keeps us polite on
 * Render's shared IP. ~6 symbols x 400 ms = ~2.5 s, fine for a Telegram command.
 *
 * @param {string[]} symbols  e.g. ["NIFTYBEES.NS", "GOLDBEES.NS"]
 * @returns {Promise<Object>} { [symbol]: { price, changePct } }
 */
async function fetchETFs(symbols) {
  const out = {};

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const q = await chartQuote(sym);
      out[sym] = { price: q.price, changePct: q.changePct };
    } catch (err) {
      error("Yahoo batch fetch failed for " + sym, err.message);
      throw err;
    }
    if (i < symbols.length - 1) await sleep(400);
  }

  return out;
}

module.exports = { fetchETF, fetchETFs };

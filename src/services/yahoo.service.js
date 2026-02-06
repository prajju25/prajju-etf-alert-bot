const YahooFinance = require("yahoo-finance2").default;
const { log, error } = require("../utils/logger");

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function fetchETF(symbol) {
  try {
    const q = await yf.quote(symbol);

    const changePct =
      ((q.regularMarketPrice - q.regularMarketPreviousClose) /
        q.regularMarketPreviousClose) *
      100;

    log(
      `Fetched ${symbol}: ₹${q.regularMarketPrice} (${changePct.toFixed(2)}%)`,
    );

    return {
      price: q.regularMarketPrice,
      changePct: Number(changePct.toFixed(2)),
    };
  } catch (err) {
    error(`Yahoo fetch failed for ${symbol}`, err.message);
    throw err;
  }
}

module.exports = { fetchETF };

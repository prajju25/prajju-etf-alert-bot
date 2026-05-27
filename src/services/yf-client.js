/**
 * Shared yahoo-finance2 client.
 *
 * A single instance is intentional: yahoo-finance2 fetches a "crumb" (session
 * token) the first time it talks to Yahoo Finance and caches it internally.
 * Creating multiple instances means multiple crumb fetches → more 429 exposure
 * from Render's datacenter IP.  One shared instance = one crumb fetch per
 * process lifetime.
 */
const YahooFinance = require("yahoo-finance2").default;

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries an async function when Yahoo Finance returns 429 Too Many Requests.
 *
 * Render's shared datacenter IPs sometimes hit Yahoo's rate limits on the
 * initial crumb fetch.  Retrying with increasing delays usually clears it
 * within the first two attempts.
 *
 * @param {Function} fn         - zero-arg async function to retry
 * @param {number}   maxRetries - total attempts (default 3)
 * @param {number}   baseDelay  - ms for first retry; doubles each time (default 3 s)
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
        // warn is imported lazily to avoid circular dep; use console here
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

module.exports = { yf, sleep, fetchWithRetry };

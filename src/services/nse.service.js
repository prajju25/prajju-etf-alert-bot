const { yf, fetchWithRetry } = require("./yf-client");
const { log, warn } = require("../utils/logger");

/**
 * Checks whether today is an NSE trading holiday.
 *
 * Strategy: fetch the last regular market trade timestamp for NIFTYBEES.NS.
 * If the last trade date (in IST) is not today, the market never opened → holiday.
 *
 * This works at both 9:30 AM (daily savings) and 3:00 PM (market scan):
 *  - 9:30 AM: NSE opens at 9:15 AM, so 15 min of trades already exist if today is a trading day.
 *  - 3:00 PM: Market has been open 6 hours — very reliable.
 *
 * Note: yahoo-finance2 returns regularMarketTime as a JS Date object (not Unix seconds).
 * Fails open: if Yahoo Finance is unreachable, bot runs normally.
 */
async function isNSEHoliday() {
  try {
    const quote = await fetchWithRetry(() => yf.quote("NIFTYBEES.NS"));

    // yahoo-finance2 returns regularMarketTime as a JS Date object already
    const lastTradeDate = new Date(quote.regularMarketTime).toLocaleDateString(
      "en-CA", // gives YYYY-MM-DD format
      { timeZone: "Asia/Kolkata" }
    );

    const todayIST = new Date().toLocaleDateString(
      "en-CA",
      { timeZone: "Asia/Kolkata" }
    );

    if (lastTradeDate !== todayIST) {
      log(`🏖️ NSE Holiday detected — last trade: ${lastTradeDate}, today: ${todayIST}`);
      return true;
    }

    log(`✅ Market open — last trade: ${lastTradeDate} matches today`);
    return false;
  } catch (err) {
    warn(`Holiday check via Yahoo Finance failed: ${err.message} — assuming market is open`);
    return false; // fail-open: never silently block the bot
  }
}

/**
 * Counts the number of weekdays (Mon–Fri) in a given month.
 * Used as a proxy for trading days when no holiday list is available.
 *
 * On average, NSE has 1–2 trading holidays per month. Using weekdays as
 * the denominator means the daily budget is slightly conservative; any
 * unspent cash from skipped holidays stays in the cash pool and rolls forward.
 *
 * @param {number} year  - Full year e.g. 2026
 * @param {number} month - 0-indexed (0 = Jan, 11 = Dec)
 */
function countWeekdaysInMonth(year, month) {
  let count = 0;
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
}

/**
 * Returns the daily savings amount for the current month.
 *
 * Formula: monthlyBudget / weekdays in current month
 *
 * Because we skip NSE holidays, the actual total accumulated will be:
 *   (weekdays - NSE_holidays_this_month) * dailyBudget
 *
 * This is slightly under 15,000 on months with holidays, but the difference
 * (typically 600-1,500) rolls forward as cash for the next month's buying.
 *
 * @param {number} monthlyBudget
 */
function getDailyBudget(monthlyBudget) {
  const now = new Date();
  const weekdays = countWeekdaysInMonth(now.getFullYear(), now.getMonth());
  const daily = Math.round(monthlyBudget / weekdays);
  log(`${now.toLocaleString("default", { month: "long" })} has ${weekdays} weekdays -> daily budget = Rs.${daily}`);
  return daily;
}

module.exports = { isNSEHoliday, getDailyBudget };

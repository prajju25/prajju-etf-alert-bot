const allocation = require("../config/allocation");
const { getDailyCash, updateDailyCash } = require("../services/sheets.service");
const { isNSEHoliday, getDailyBudget } = require("../services/nse.service");
const { log } = require("../utils/logger");

async function runDailySavings() {
  log("Daily Savings Job Started");

  if (await isNSEHoliday()) {
    log("🏖️ NSE Holiday today — skipping daily savings accumulation");
    return;
  }

  // Compute daily budget dynamically: ₹15,000 ÷ actual trading days this month
  const dailyAmount = await getDailyBudget(allocation.monthlyBudget);

  const current = await getDailyCash();
  const updated = current + dailyAmount;
  log(`Daily saving added ₹${dailyAmount}. Cash = ₹${updated}`);

  await updateDailyCash(updated);
  log(`Daily cash updated to ₹${updated}`);
}

module.exports = { runDailySavings };

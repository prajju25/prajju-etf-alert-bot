const allocation = require("../config/allocation");
const { getDailyCash, updateDailyCash } = require("../services/sheets.service");
const { log } = require("../utils/logger");

async function runDailySavings() {
  log("Daily Savings Job Started");

  const current = await getDailyCash();
  const updated = current + allocation.dailyBase;
  log(`Daily saving added ₹${allocation.dailyBase}. Cash = ₹${updated}`);

  await updateDailyCash(updated);

  log(`Daily cash updated to ₹${updated}`);
}
module.exports = { runDailySavings };

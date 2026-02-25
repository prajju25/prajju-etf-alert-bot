const { updateDailyCash } = require("../services/sheets.service");
const { log } = require("../utils/logger");

async function runMonthlyReset() {
  log("Monthly Reset Started");

  await updateDailyCash(0);

  log("Cash reset to 0");
}
module.exports = { runMonthlyReset };

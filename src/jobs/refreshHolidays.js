/**
 * refreshHolidays.js
 *
 * Fetches the NSE trading holiday list for the current year and writes it
 * to nse-holidays.json in the project root. Run this once a year (Jan 2nd)
 * via the refresh-holidays GitHub Actions workflow, or manually:
 *
 *   node src/jobs/refreshHolidays.js
 */

require("dotenv").config();
const { getHolidays } = require("../services/nse.service");
const { log } = require("../utils/logger");
const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.resolve(__dirname, "../../nse-holidays.json");

async function refreshHolidays() {
  log("Starting NSE holiday refresh...");

  // Delete existing cache so nse.service always goes to the API
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
    log("Deleted stale cache file");
  }

  // getHolidays() will fetch from NSE API and write the new cache file
  const holidays = await getHolidays();

  if (holidays.length === 0) {
    console.error("❌ Failed to fetch holidays — cache not updated");
    process.exit(1);
  }

  log(`✅ Holiday refresh complete: ${holidays.length} NSE trading holidays cached for ${new Date().getFullYear()}`);
  holidays.forEach((h) => log(`  • ${h}`));
}

refreshHolidays().catch((err) => {
  console.error("❌ refreshHolidays crashed:", err.message);
  process.exit(1);
});

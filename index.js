require("dotenv").config();

// Bootstrap Google credentials from env var (cloud deployment).
// Locally, credentials.json already exists on disk — this block is skipped.
const fs = require("fs");
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync("./credentials.json")) {
  fs.writeFileSync("./credentials.json", process.env.GOOGLE_CREDENTIALS);
  console.log("Google credentials written from GOOGLE_CREDENTIALS env var");
}

const cron = require("node-cron");

const { sendMessageAlerts } = require("./src/services/messaging.service");
const { log } = require("./src/utils/logger");
const { runDailySavings } = require("./src/jobs/dailySavings");
const { runMonthlyReset } = require("./src/jobs/monthlyReset");
const { runMarketScan } = require("./src/jobs/marketScan");
const { startTelegramListener } = require("./src/services/telegram.listener");
const { loadAllocationConfig } = require("./src/services/sheets.service");
const { update: updateAllocation } = require("./src/config/dynamicAllocation");

/* ─── Startup: load persisted allocation from Google Sheets ─────────────── */
async function bootstrap() {
  try {
    const saved = await loadAllocationConfig();
    if (saved) {
      updateAllocation(saved);
      log("Allocation loaded from Sheets: " + JSON.stringify(saved));
    } else {
      log("Using default allocation (no saved config found)");
    }
  } catch (err) {
    log("Could not load allocation config from Sheets — using defaults");
  }

  // Start two-way Telegram command listener
  startTelegramListener();
}

bootstrap();

/* ─── Crash guards ──────────────────────────────────────────────────────── */
process.on("uncaughtException", async (err) => {
  console.error("CRASH DETECTED:", err.message);
  try {
    await sendMessageAlerts(
      "BOT CRASHED!\n\nError: " + err.message + "\nTime: " + new Date().toISOString() + "\nStatus: restarting..."
    );
  } catch (e) {}
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  console.error("Promise rejected:", reason);
  try {
    await sendMessageAlerts("PROMISE FAILED!\n\nReason: " + reason + "\nStatus: Auto-restarting...");
  } catch (e) {}
  process.exit(1);
});

/* ─── Cron jobs ─────────────────────────────────────────────────────────── */

// 9:30 AM IST weekdays — add daily savings to cash pool
cron.schedule("30 9 * * 1-5", async () => {
  await runDailySavings();
}, { timezone: "Asia/Kolkata" });

// 3:00 PM IST weekdays — market scan + buy decision
cron.schedule("0 15 * * 1-5", async () => {
  await runMarketScan();
}, { timezone: "Asia/Kolkata" });

// 1st of month midnight — reset monthly cash
cron.schedule("0 0 1 * *", async () => {
  await runMonthlyReset();
}, { timezone: "Asia/Kolkata" });

// Heartbeat every 30 min
cron.schedule("*/30 * * * *", () => {
  log("Heartbeat OK");
});

/* ─── Health check server ───────────────────────────────────────────────── */
const http = require("http");
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ETF Bot running");
  })
  .listen(PORT, () => log("Health check server listening on port " + PORT));

log("ETF BOT RUNNING");

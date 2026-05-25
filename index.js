require("dotenv").config();

// Bootstrap Google credentials from env var (Koyeb / any cloud deployment).
// Locally, credentials.json already exists on disk — this block is skipped.
const fs = require("fs");
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync("./credentials.json")) {
  fs.writeFileSync("./credentials.json", process.env.GOOGLE_CREDENTIALS);
  console.log("✅ Google credentials written from GOOGLE_CREDENTIALS env var");
}

const cron = require("node-cron");

const { sendMessageAlerts } = require("./src/services/messaging.service");

const { log } = require("./src/utils/logger");
const { runDailySavings } = require("./src/jobs/dailySavings");
const { runMonthlyReset } = require("./src/jobs/monthlyReset");
const { runMarketScan } = require("./src/jobs/marketScan");

// VM Crash Detection + Telegram Alert
process.on("uncaughtException", async (error) => {
  console.error("🚨 CRASH DETECTED:", error.message);

  try {
    await sendMessageAlerts(
      `🚨 VM/BOT CRASHED!\n\n` +
        `Error: ${error.message}\n` +
        `Time: ${new Date().toISOString()}\n` +
        `Status: VM restarting...`,
    );
  } catch (telegramError) {
    console.error("Failed to send Telegram alert:", telegramError);
  }

  // Exit with failure (triggers PM2 restart)
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("🚨 Promise rejected:", reason);

  try {
    await sendMessageAlerts(
      `🚨 PROMISE FAILED!\n\nReason: ${reason}\nStatus: Auto-restarting...`,
    );
  } catch (e) {}

  process.exit(1);
});

/* ================= DAILY SAVINGS ================= */
cron.schedule(
  "30 9 * * 1-5", // 3:00 PM IST
  async () => {
    await runDailySavings();
  },
  { timezone: "Asia/Kolkata" },
);

/* ================= MONTH RESET ================= */
cron.schedule(
  "0 0 1 * *",
  async () => {
    await runMonthlyReset();
  },
  { timezone: "Asia/Kolkata" },
);

/* ================= HEARTBEAT ================= */
cron.schedule("*/30 * * * *", () => {
  log("Heartbeat OK");
});

/* ================= 3 PM MARKET SCAN ================= */
cron.schedule(
  "0 15 * * 1-5",
  async () => {
    await runMarketScan();
  },
  { timezone: "Asia/Kolkata" },
);

// Minimal health check server — required by Back4App Containers.
// Back4App needs an open port to confirm the container is alive.
const http = require("http");
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ETF Bot running ✅");
  })
  .listen(PORT, () => log(`Health check server listening on port ${PORT}`));

log("✅ ETF BOT RUNNING");

require("dotenv").config();
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

log("✅ ETF BOT RUNNING");

require("dotenv").config();
const cron = require("node-cron");

const ETFs = require("./src/config/etfs");
const allocation = require("./src/config/allocation");

const { fetchETF } = require("./src/services/yahoo.service");
const {
  getHoldings,
  writeTransaction,
  updateHoldings,
} = require("./src/services/sheets.service");
const { getBuySuggestions } = require("./src/services/gpt.service");
const { sendMessageAlerts } = require("./src/services/messaging.service");

const { violatesGuardrail } = require("./src/engine/guardrails.engine");
const { getZone } = require("./src/engine/signal.engine");

const { log, error, warn } = require("./src/utils/logger");
const { nowIST } = require("./src/utils/time");

let dailyCash = 0;
const RUN_MODE = process.env.RUN_MODE || "LIVE";

/* ================= DAILY SAVINGS ================= */
cron.schedule(
  "30 9 * * 1-5", // 3:00 PM IST
  () => {
    dailyCash += allocation.dailyBase;
    log(`Daily saving added ₹${allocation.dailyBase}. Cash = ₹${dailyCash}`);
  },
  { timezone: "Asia/Kolkata" },
);

/* ================= MONTH RESET ================= */
cron.schedule(
  "0 0 1 * *",
  () => {
    dailyCash = 0;
    log("Monthly cash reset done");
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
    try {
      log("3PM Market Scan Started");

      const holdings = await getHoldings();
      const market = {};
      let totalInvested = Object.values(holdings).reduce(
        (s, h) => s + h.invested,
        0,
      );

      for (const etf of ETFs) {
        const data = await fetchETF(etf.symbol);
        const zone = getZone(data.changePct, allocation);

        market[etf.symbol] = {
          ...data,
          zone,
          name: etf.name,
          category: etf.category,
        };
      }

      const gptDecision = await getBuySuggestions({
        holdings,
        market,
        cash: dailyCash,
      });

      const finalBuys = [];

      for (const buy of gptDecision.buy) {
        const etf = ETFs.find((e) => e.symbol === buy.symbol);
        if (!etf) continue;

        if (violatesGuardrail(etf, holdings, totalInvested, allocation)) {
          warn(`Guardrail blocked ${etf.name}`);
          continue;
        }

        finalBuys.push(buy);
        dailyCash -= buy.amount;
      }

      let msg = `📊 ETF BOT – ${nowIST()}\nCash: ₹${dailyCash}\n\n`;

      if (finalBuys.length) {
        msg += "✅ BUY:\n";
        finalBuys.forEach((b) => {
          msg += `${b.symbol} ₹${b.amount}\n${b.reason}\n\n`;
        });
      } else {
        msg += "⏸ No buy today (Market heated / rules blocked)";
      }

      await sendMessageAlerts(msg);
      log("3PM Scan completed");

      for (const buy of finalBuys) {
        if (RUN_MODE !== "BACKTEST") {
          if (RUN_MODE === "LIVE") {
            await writeTransaction({
              symbol: buy.symbol,
              qty: buy.qty,
              price: buy.price,
              amount: buy.amount,
              mode: RUN_MODE,
            });
            await updateHoldings(buy.symbol, buy.qty, buy.amount);
          }
        }
      }
    } catch (err) {
      error("3PM Scan failed", err.message);
    }
  },
  { timezone: "Asia/Kolkata" },
);

log("✅ ETF BOT RUNNING");

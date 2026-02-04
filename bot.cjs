require("dotenv").config();
const YahooFinance = require("yahoo-finance2").default;
const cron = require("node-cron");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/* ---------------- GLOBAL ERROR HANDLER ---------------- */
process.on("unhandledRejection", (err) => {
  printLogs("Unhandled Promise Rejection:", "error", err);
});
process.on("uncaughtException", (err) => {
  printLogs("Uncaught Exception:", "error", err);
});

/* ---------------- ETF SETUP ---------------- */
const ETFs = [
  {
    name: "NiftyBees",
    symbol: "NIFTYBEES.NS",
    target: 3750,
    priority: 1,
    spent: 0,
  },
  {
    name: "ICICI Next 50",
    symbol: "ICICINXT50.NS",
    target: 3000,
    priority: 2,
    spent: 0,
  },
  {
    name: "ICICI Pharma",
    symbol: "ICICIPHARM.NS",
    target: 1500,
    priority: 3,
    spent: 0,
  },
  {
    name: "Nasdaq 100",
    symbol: "MON100.NS",
    target: 2250,
    priority: 4,
    spent: 0,
  },
  {
    name: "GoldBees",
    symbol: "GOLDBEES.NS",
    target: 2250,
    priority: 5,
    spent: 0,
  },
  {
    name: "SilverBees",
    symbol: "SILVERBEES.NS",
    target: 1500,
    priority: 6,
    spent: 0,
  },
];

let dailySavings = 0;
let cashBuffer = 750;
let isMonthEnd = false;

/* ---------------- ZONE DETECTION ---------------- */
function getZone(changePercent) {
  if (changePercent <= -2) return "crash";
  if (changePercent <= 1) return "normal";
  return "skip"; // STRICT RULE
}

/* Print Console Logs ---------------- */
function printLogs(message, type = "info", err = null) {
  const now = new Date();
  const timestamp = now.toLocaleString();
  switch (type) {
    case "info":
      console.log(`${timestamp} | 💡 ${message}`);
      break;
    case "error":
      console.error(`${timestamp} | ❌ ${message}`, err);
      break;
    case "warning":
      console.warn(`${timestamp} | ⚠️ ${message}`);
      break;
    default:
      console.log(`${timestamp} | 💡 ${message}`);
      break;
  }
}

/* ---------------- FETCH ETF DATA ---------------- */
async function analyzeETF(etf) {
  try {
    const data = await yf.quote(etf.symbol);

    if (!data.regularMarketPrice || !data.regularMarketPreviousClose) {
      throw new Error("Market data missing");
    }

    const current = data.regularMarketPrice;
    const prevClose = data.regularMarketPreviousClose;
    const changePercent = ((current - prevClose) / prevClose) * 100;

    return {
      etf,
      current,
      changePercent: changePercent.toFixed(2),
      zone: getZone(changePercent),
      canBuy: etf.spent < etf.target,
    };
  } catch (err) {
    printLogs(`Error fetching ${etf.name}:`, "error", err.message);
    return { etf, error: true };
  }
}

/* ---------------- WHATSAPP SAFE SEND ---------------- */
async function sendWhatsApp(message) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: process.env.YOUR_WHATSAPP_NUMBER,
      body: message,
    });
    printLogs("📲 WhatsApp alert sent");
  } catch (err) {
    printLogs("WhatsApp send failed:", "error", err.message);
  }
}

/* ---------------- MONTH RESET ---------------- */
cron.schedule(
  "30 4 1 * *",
  () => {
    ETFs.forEach((e) => (e.spent = 0));
    dailySavings = 0;
    cashBuffer = 750;
    isMonthEnd = false;
    printLogs("📅 Monthly reset complete");
  },
  { timezone: "UTC" },
);

/* ---------------- DAILY SAVINGS ---------------- */
cron.schedule(
  "30 4 * * 1-5",
  () => {
    dailySavings += 500;
    printLogs(`💰 Savings added. Total: ₹${dailySavings}`);
  },
  { timezone: "UTC" },
);

/* ---------------- MONTH END DETECTOR ---------------- */
cron.schedule(
  "0 * * * *",
  () => {
    const now = new Date();
    const day = now.getUTCDate();
    const lastDay = new Date(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      0,
    ).getUTCDate();
    if (day >= lastDay - 2) isMonthEnd = true;
  },
  { timezone: "UTC" },
);

/* ---------------- HEARTBEAT ---------------- */
cron.schedule("*/30 * * * *", () => {
  const now = new Date();
  printLogs("💓 Bot heartbeat — running fine");
});

/* ---------------- MAIN SCAN (3PM IST) ---------------- */
cron.schedule(
  "30 9 * * 1-5",
  async () => {
    printLogs("🔍 Market scan started");

    try {
      let alerts = [];
      let buyList = [];
      let errors = [];

      for (let etf of ETFs) {
        const signal = await analyzeETF(etf);

        if (signal.error) {
          errors.push(etf.name);
          continue;
        }

        alerts.push(signal);

        if (!signal.canBuy || dailySavings < 300 || signal.zone === "skip")
          continue;

        let buyAmount =
          signal.zone === "crash"
            ? Math.min(1500, dailySavings + cashBuffer)
            : 500;
        if (signal.zone === "crash") cashBuffer = 0;

        const units = Math.floor(buyAmount / signal.current);
        if (units > 0) {
          const actual = units * signal.current;
          dailySavings -= actual;
          signal.etf.spent += actual;

          buyList.push({
            name: signal.etf.name,
            amount: actual.toFixed(0),
            units,
          });
        }
      }

      /* ---------------- ALERT MESSAGE ---------------- */
      const now = new Date();
      let msg = `📉 ETF BOT UPDATE - ${now.toLocaleString()}\n\n💰 Cash: ₹${dailySavings.toFixed(0)} (+₹${cashBuffer})\n\n`;

      alerts.forEach((a) => {
        msg += `📊 ${a.etf.name}: ${a.changePercent}% → ${a.zone.toUpperCase()}\n`;
      });

      if (buyList.length > 0) {
        msg += `\n🎯 BUY TODAY:\n`;
        buyList.forEach(
          (b) => (msg += `✅ ${b.name}: ₹${b.amount} (${b.units} units)\n`),
        );
      } else {
        msg += `\n⏸ No buys today (market not in buy zone or low cash)\n`;
      }

      if (errors.length > 0) {
        msg += `\n⚠ Data fetch failed for: ${errors.join(", ")}`;
      }

      await sendWhatsApp(msg);
    } catch (err) {
      printLogs("Scan crashed:", "error", err.message);
      const now = new Date();
      await sendWhatsApp(
        `${now.toLocaleString()} | 🚨 ETF BOT ERROR: ${err.message}`,
      );
    }
  },
  { timezone: "UTC" },
);

console.log("✅ ETF BOT WITH FULL ERROR HANDLING RUNNING");

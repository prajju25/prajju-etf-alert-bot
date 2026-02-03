require("dotenv").config();
const YahooFinance = require("yahoo-finance2").default;
const cron = require("node-cron");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

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
    name: "Nasdaq 100",
    symbol: "MON100.NS",
    target: 2250,
    priority: 4,
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

async function checkDip(etf) {
  try {
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const data = await yf.quote(etf.symbol);
    const current = data.regularMarketPrice;
    const prevClose = data.regularMarketPreviousClose;
    const changePercent = ((current - prevClose) / prevClose) * 100;

    if (changePercent <= -1) {
      return {
        etf,
        current,
        drop: changePercent.toFixed(2),
        canBuy: etf.spent < etf.target,
        bigCrash: changePercent <= -2,
      };
    }
    return null;
  } catch (err) {
    console.error(`Error fetching ${etf.name}`, err);
    return null;
  }
}

async function sendWhatsApp(message) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: process.env.YOUR_WHATSAPP_NUMBER,
      body: message,
    });
    console.log("✅ WhatsApp alert sent!");
  } catch (err) {
    console.error("❌ WhatsApp error:", err.message);
  }
}

// 🔥 FIXED CRON SCHEDULES - No invalid syntax
cron.schedule(
  "30 3 1 * *",
  () => {
    // 1st trading day 9:30AM IST (UTC)
    ETFs.forEach((etf) => (etf.spent = 0));
    dailySavings = 0;
    cashBuffer = 750;
    isMonthEnd = false;
    console.log("📅 Monthly allocations reset");
  },
  { timezone: "UTC" },
);

cron.schedule(
  "30 3 * * 1-5",
  () => {
    // Daily 9:30AM IST (UTC)
    dailySavings += 500;
    console.log(`💰 Daily savings: ₹${dailySavings}`);
  },
  { timezone: "UTC" },
);

// Check if last 3 days of month (runs daily, checks date)
cron.schedule(
  "0 * * * *",
  () => {
    // Hourly check
    const now = new Date();
    const day = now.getUTCDate();
    const lastDay = new Date(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      0,
    ).getUTCDate();

    if (day >= lastDay - 2 && day <= lastDay) {
      isMonthEnd = true;
      console.log(`📅 Month-end mode activated (Day ${day}/${lastDay})`);
    }
  },
  { timezone: "UTC" },
);

cron.schedule(
  "55 3 * * 1-5",
  async () => {
    // 9:25AM IST scan (UTC)
    console.log("🔍 Scanning red days...");

    let signals = [];
    let buyRecommendations = [];

    for (let etf of ETFs) {
      const signal = await checkDip(etf);
      if (signal) {
        signals.push(signal);

        const availableCash = dailySavings + (signal.bigCrash ? cashBuffer : 0);
        if (signal.canBuy && availableCash >= 500) {
          const buyAmount = signal.bigCrash
            ? Math.min(1000, availableCash)
            : 500;
          buyRecommendations.push({
            etf: signal.etf.name,
            amount: buyAmount,
            drop: signal.drop,
            bigCrash: signal.bigCrash,
          });

          signal.etf.spent += buyAmount;
          dailySavings -= buyAmount;
          if (signal.bigCrash) cashBuffer = 0;
        }
      }
    }

    buyRecommendations.sort(
      (a, b) =>
        ETFs.find((e) => e.name === a.etf).priority -
        ETFs.find((e) => e.name === b.etf).priority,
    );

    if (signals.length > 0 || isMonthEnd) {
      let alert = "📉 ETF UPDATE\n\n";
      alert += `💰 Cash: ₹${dailySavings.toFixed(0)} (+₹${cashBuffer} buffer)\n`;
      alert += `📅 Month-end: ${isMonthEnd ? "YES" : "NO"}\n\n`;

      if (signals.length > 0) {
        signals.forEach((s) => {
          alert += `📊 ${s.etf.name}: -${s.drop}% (₹${s.current})\n`;
          alert += `   Target: ₹${s.etf.target} | Spent: ₹${s.etf.spent}\n\n`;
        });

        if (buyRecommendations.length > 0) {
          alert += "🎯 BUY:\n";
          buyRecommendations.forEach((rec) => {
            const emoji = rec.bigCrash ? "🚨" : "✅";
            alert += `${emoji} ${rec.etf}: ₹${rec.amount}\n`;
          });
        }
      } else if (isMonthEnd) {
        alert += "📅 MONTH-END: Deploy remaining cash to NiftyBees/Next50/Gold";
      }

      await sendWhatsApp(alert);
    }
  },
  { timezone: "UTC" },
);

console.log("✅ ETF Bot running perfectly!");

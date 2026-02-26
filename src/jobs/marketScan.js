const allocation = require("../config/allocation");
const ETFs = require("../config/etfs");
const { violatesGuardrail } = require("../engine/guardrails.engine");
const { getZone } = require("../engine/signal.engine");
const { getBuySuggestions } = require("../services/gpt.service");
const { sendMessageAlerts } = require("../services/messaging.service");
const {
  getDailyCash,
  getHoldings,
  updateHoldings,
  writeTransaction,
  updateDailyCash,
} = require("../services/sheets.service");
const { fetchETF } = require("../services/yahoo.service");
const { error, log, warn } = require("../utils/logger");
const { nowIST } = require("../utils/time");

const RUN_MODE = process.env.RUN_MODE || "LIVE"; // LIVE, BACKTEST, PAPER

async function runMarketScan() {
  try {
    log("3PM Market Scan Started");

    const holdings = await getHoldings();
    let dailyCash = await getDailyCash();
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
    let investingAmount = 0;

    for (const buy of gptDecision.buy) {
      const etf = ETFs.find((e) => e.symbol === buy.symbol);
      if (!etf) continue;

      if (violatesGuardrail(etf, holdings, totalInvested, allocation)) {
        warn(`Guardrail blocked ${etf.name}`);
        continue;
      }

      finalBuys.push(buy);
      investingAmount += buy.price * buy.qty;
    }
    dailyCash -= investingAmount;

    let msg = `📊 ETF BOT – ${nowIST()}\nToday Investing amount: ₹${investingAmount}\nCarry forwarded Cash: ₹${dailyCash}\n\n`;

    if (finalBuys.length) {
      msg += "✅ BUY:\n";
      finalBuys.forEach((b) => {
        msg += `${b.symbol}\nPrice:₹${b.price}\nQuantity:${b.qty}\nTotal Buy Order Price: ₹${b.price * b.qty}\nReason: ${b.reason}\n\n`;
      });
    } else {
      msg += "⏸ No buy today (Market heated / rules blocked)";
    }

    await sendMessageAlerts(msg);
    log("3PM Scan completed");

    log("Updating google sheets with the Transactions and Holdings");
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
    log("Updated google sheets with the Transactions and Holdings");
    await updateDailyCash(dailyCash);
  } catch (err) {
    error("3PM Scan failed", err.message);
  }
}
module.exports = { runMarketScan };

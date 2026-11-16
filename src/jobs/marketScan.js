const { get: getDynamicAllocation } = require("../config/dynamicAllocation");
const ETFs = require("../config/etfs");
const { violatesGuardrail } = require("../engine/guardrails.engine");
const { getZone } = require("../engine/signal.engine");
const { buildAllocationContext, planBuys, tradingDaysLeft } = require("../engine/sizing.engine");
const { sendMessageAlerts } = require("../services/messaging.service");
const {
  getDailyCash,
  getHoldings,
  updateHoldings,
  writeTransaction,
  updateDailyCash,
} = require("../services/sheets.service");
const { fetchETF } = require("../services/yahoo.service");
const { isNSEHoliday, getDailyBudget } = require("../services/nse.service");
const { sleep } = require("../services/yf-client");
const { error, log, warn } = require("../utils/logger");
const { nowIST } = require("../utils/time");

const RUN_MODE = process.env.RUN_MODE || "LIVE"; // LIVE, BACKTEST, PAPER

/**
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]  Preview only — send the Telegram alert but make
 *                                 NO writes to Google Sheets (transactions,
 *                                 holdings, daily cash). Used by the /scan
 *                                 Telegram command. Cron calls this with no args.
 */
async function runMarketScan(opts = {}) {
  const dryRun = opts.dryRun === true;
  try {
    log(dryRun ? "Market Scan Started (DRY RUN — no Sheet writes)" : "3PM Market Scan Started");

    if (await isNSEHoliday()) {
      log("NSE Holiday today — skipping market scan");
      await sendMessageAlerts("NSE Holiday today — Market closed. Bot skipped. See you tomorrow!");
      return;
    }

    // Read allocation at scan time so Telegram changes take effect immediately
    const allocation = getDynamicAllocation();

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

      // 1.5 s gap between Yahoo Finance calls — reduces 429 risk on Render's
      // shared datacenter IP.  6 ETFs x 1.5 s = ~9 s total, well within cron window.
      await sleep(1500);
    }

    // Sizing is deterministic and paced (see engine/sizing.engine.js): the pool plus
    // the rest of the month's savings is spread over the remaining trading days, and
    // the drop tier (0-1 / 1-2 / 2-3 / 3+ %) scales each ETF's slice.
    const rows = buildAllocationContext(holdings, market, allocation);
    const plan = planBuys({
      rows,
      pool: dailyCash,
      dailyAccrual: getDailyBudget(allocation.monthlyBudget),
      daysLeft: tradingDaysLeft(),
      allocation,
      isBlocked: (symbol) => {
        const etf = ETFs.find((e) => e.symbol === symbol);
        const blocked = !etf || violatesGuardrail(etf, holdings, totalInvested, allocation);
        if (blocked) warn("Guardrail blocked " + symbol);
        return blocked;
      },
    });
    log("Pace: budget Rs." + plan.budget + "/day, cap Rs." + plan.dayCap + ", " + plan.daysLeft + " trading days left, pool Rs." + dailyCash);
    plan.skipped.forEach((s) => log("Skip " + s.symbol + ": " + s.reason));

    const finalBuys = plan.buy;
    const investingAmount = Number(finalBuys.reduce((s, b) => s + b.amount, 0).toFixed(2));
    dailyCash = Number((dailyCash - investingAmount).toFixed(2));

    let msg = (dryRun ? "[DRY RUN] " : "") + "ETF BOT - " + nowIST() + "\nToday Investing amount: Rs." + investingAmount + "\nCarry forwarded Cash: Rs." + dailyCash + "\nPace: Rs." + Math.round(plan.budget) + "/day over " + plan.daysLeft + " trading days left (max Rs." + Math.round(plan.dayCap) + " today)\n\n";

    if (finalBuys.length) {
      msg += "BUY:\n";
      finalBuys.forEach((b) => {
        msg += b.symbol + "\nPrice:Rs." + b.price + "\nQuantity:" + b.qty + "\nTotal Buy Order Price: Rs." + b.amount + "\nReason: " + b.reason + "\n\n";
      });
    } else {
      msg += "No buy today (no ETF in a dip with room under its allocation target)";
    }

    await sendMessageAlerts(msg);
    log("3PM Scan completed");

    if (dryRun) {
      log("Dry run — skipping all Google Sheets writes");
      return;
    }

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
    if (dryRun) throw err; // let the /scan Telegram command surface the failure
  }
}
module.exports = { runMarketScan };

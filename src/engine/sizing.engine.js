/**
 * Paced, tier-based buy sizing (replaces the old "ask the LLM to split all cash").
 *
 * Why: handing the model the whole cash pool made it spend everything on the
 * first small dip, leaving nothing for a bigger dip the next day. Here the
 * amount is decided in code, deterministically:
 *
 *   1. DAILY BUDGET  B = (pool + dailyAccrual * (daysLeft - 1)) / daysLeft
 *        The pool plus everything still to be saved this month, spread evenly
 *        over the remaining trading days. A day with no buy raises tomorrow's B.
 *   2. ETF SLICE     slice = B * (ETF monthly target / sum of all targets)
 *        Only an ETF that is itself dipping spends its slice - a single dipping
 *        ETF can never swallow the whole day's budget.
 *   3. DIP TIER      spend = slice * tier multiplier (config: allocation.buyTiers)
 *        0-1% drop 0.5x | 1-2% 1x | 2-3% 2x | 3%+ 3x
 *   4. QUANTITY      qty = round(spend / price); 0 means "can't afford a unit
 *        at this tier" and the money simply stays in the pool.
 *   5. LIMITS        total <= min(pool, dayCapMult * B); category / silver caps
 *        and a positive allocation gap are required to buy at all.
 *
 * Unspent cash carries forward (also across months - there is no monthly reset).
 */

/** Weekdays (Mon-Fri) from today to month end, inclusive, in IST. Always >= 1. */
function tradingDaysLeft(now = new Date()) {
  const [y, m, d] = now
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .split("-")
    .map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // m is 1-based here -> day 0 of next month
  let count = 0;
  for (let day = d; day <= lastDay; day++) {
    const dow = new Date(y, m - 1, day).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return Math.max(1, count);
}

/** Tier multiplier for a day change (<= 0). Highest tier whose minDrop is reached. */
function tierFor(changePct, tiers) {
  const drop = Math.abs(Math.min(changePct, 0));
  let hit = null;
  for (const t of [...tiers].sort((a, b) => a.minDrop - b.minDrop)) {
    if (drop >= t.minDrop) hit = t;
  }
  return hit;
}

const r2 = (n) => Number(n.toFixed(2));

/**
 * Per-ETF allocation context: today's quote plus where the ETF sits versus
 * its target. Used by the scan (sizing) and the /target Telegram command.
 *
 *  - gapPct          : category target% - current%  (+ve = under-allocated)
 *  - monthlyTarget   : category budget share / ETFs in category, in Rs.
 * The *String* fields (targetAllocation, allocationGap, monthlyTargetAmount)
 * are the display forms /target prints.
 */
function buildAllocationContext(holdings, market, allocationRules) {
  const totalInvested = Object.values(holdings).reduce((sum, h) => sum + h.invested, 0);
  const targets = allocationRules.maxAllocationPercent;
  const monthlyBudget = allocationRules.monthlyBudget;

  const categoryTarget = {
    core: targets.core,
    sector: targets.sector,
    global: targets.global,
    commodity: targets.commodity,
  };

  const categoryCount = {};
  for (const data of Object.values(market)) {
    categoryCount[data.category] = (categoryCount[data.category] || 0) + 1;
  }

  const rows = [];
  for (const [symbol, data] of Object.entries(market)) {
    const holding = holdings[symbol] || { invested: 0, qty: 0 };
    const currentPct = totalInvested > 0 ? Number(((holding.invested / totalInvested) * 100).toFixed(1)) : 0;
    const targetPct = categoryTarget[data.category] ?? 0;
    const gapPct = Number((targetPct - currentPct).toFixed(1));
    const monthlyTarget = Math.round(((targetPct / 100) * monthlyBudget) / (categoryCount[data.category] || 1));

    rows.push({
      symbol,
      name: data.name,
      category: data.category,
      changePct: data.changePct,
      zone: data.zone,
      price: data.price,
      currentPct,
      gapPct,
      monthlyTarget,
      currentAllocation: currentPct + "%",
      targetAllocation: targetPct + "%",
      allocationGap: (gapPct >= 0 ? "+" : "") + gapPct + "%",
      monthlyTargetAmount: "₹" + monthlyTarget,
    });
  }
  return rows;
}

/**
 * @param {object} p
 * @param {Array}  p.rows           buildAllocationContext() rows (need numeric fields)
 * @param {number} p.pool           cash pool right now (today's saving already added)
 * @param {number} p.dailyAccrual   amount added to the pool each trading day
 * @param {number} p.daysLeft       trading days left this month including today
 * @param {object} p.allocation     dynamicAllocation state (buyTiers, dayCapMult, maxAllocationPercent)
 * @param {(symbol:string)=>boolean} [p.isBlocked]  extra veto, e.g. guardrail
 * @returns {{buy:Array, budget:number, dayCap:number, daysLeft:number, skipped:Array}}
 */
function planBuys({ rows, pool, dailyAccrual, daysLeft, allocation, isBlocked = () => false }) {
  const days = Math.max(1, daysLeft);
  const budget = Math.max(0, (pool + dailyAccrual * (days - 1)) / days);
  const dayCap = Math.min(pool, budget * allocation.dayCapMult);
  const silverMax = allocation.maxAllocationPercent.silverMax;

  const totalTarget = rows.reduce((s, r) => s + r.monthlyTarget, 0) || 1;
  const skipped = [];
  const lines = [];

  for (const r of rows) {
    const why = (reason) => skipped.push({ symbol: r.symbol, reason });

    if (!(r.price > 0)) { why("no price"); continue; }
    if (r.changePct > 0) { why("up today"); continue; }
    if (!(r.gapPct > 0)) { why("at/above target allocation"); continue; }
    if (r.name === "SILVERBEES" && r.currentPct >= silverMax) { why("silver cap"); continue; }
    if (isBlocked(r.symbol)) { why("guardrail"); continue; }

    const tier = tierFor(r.changePct, allocation.buyTiers);
    if (!tier) { why("no tier"); continue; }

    const slice = budget * (r.monthlyTarget / totalTarget);
    lines.push({ r, tier, slice, spend: slice * tier.mult });
  }

  // Never exceed the day cap: scale every line down proportionally first.
  const wanted = lines.reduce((s, l) => s + l.spend, 0);
  const scale = wanted > dayCap && wanted > 0 ? dayCap / wanted : 1;

  const buy = [];
  for (const l of lines) {
    const qty = Math.round((l.spend * scale) / l.r.price);
    if (qty < 1) { skipped.push({ symbol: l.r.symbol, reason: "slice too small for 1 unit" }); continue; }
    buy.push({
      symbol: l.r.symbol,
      qty,
      price: l.r.price,
      amount: r2(qty * l.r.price),
      reason:
        "Down " + Math.abs(l.r.changePct) + "% (" + l.tier.mult + "x tier) | slice Rs." +
        Math.round(l.slice) + " -> Rs." + Math.round(l.spend * scale) + " | gap +" + l.r.gapPct + "%",
    });
  }

  // Rounding up must never overspend the pool: drop units from the biggest line.
  let total = buy.reduce((s, b) => s + b.amount, 0);
  while (total > pool + 1e-9 && buy.length) {
    buy.sort((a, b) => b.amount - a.amount);
    const top = buy[0];
    top.qty -= 1;
    top.amount = r2(top.qty * top.price);
    if (top.qty < 1) buy.shift();
    total = buy.reduce((s, b) => s + b.amount, 0);
  }

  return { buy, budget: r2(budget), dayCap: r2(dayCap), daysLeft: days, skipped };
}

module.exports = { planBuys, tradingDaysLeft, tierFor, buildAllocationContext };

const Anthropic = require("@anthropic-ai/sdk");
const { error, log } = require("../utils/logger");

// Model is configurable so it can be changed from the Render dashboard without a deploy.
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Created lazily so a missing ANTHROPIC_API_KEY can never crash the bot at boot;
// it surfaces as an explicit "AI decision failed" alert on the first scan instead.
let client = null;
function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

/**
 * Pulls the JSON object out of the model's reply. The prompt demands raw JSON,
 * but tolerate a ```json fence or stray prose around it rather than silently
 * losing the day's decision.
 */
function extractJson(text) {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("reply contained no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Builds per-ETF allocation context for GPT.
 *
 * For each ETF, computes:
 *  - currentAllocation%  : what % of total portfolio this ETF holds today
 *  - targetAllocation%   : what % it should hold (from config)
 *  - allocationGap       : how far below/above target (+ve = needs more, -ve = already full)
 *  - monthlyTargetAmount : its fair share of ₹15,000/month
 *                          = (categoryTarget% / totalPortfolio%) × monthlyBudget ÷ ETFs in category
 *
 * monthlyTargetAmount is the key driver: it tells GPT how to split daily cash across ETFs.
 */
function buildAllocationContext(holdings, market, allocationRules) {
  const totalInvested = Object.values(holdings).reduce(
    (sum, h) => sum + h.invested,
    0
  );

  const targets = allocationRules.maxAllocationPercent;
  const monthlyBudget = allocationRules.monthlyBudget;

  const categoryTarget = {
    core: targets.core,
    sector: targets.sector,
    global: targets.global,
    commodity: targets.commodity,
  };

  // Count ETFs per category so we split the category budget equally among them
  const categoryCount = {};
  for (const data of Object.values(market)) {
    categoryCount[data.category] = (categoryCount[data.category] || 0) + 1;
  }

  const rows = [];

  for (const [symbol, data] of Object.entries(market)) {
    const holding = holdings[symbol] || { invested: 0, qty: 0 };
    const currentPct =
      totalInvested > 0
        ? Number(((holding.invested / totalInvested) * 100).toFixed(1))
        : 0;
    const targetPct = categoryTarget[data.category] ?? 0;
    const gap = Number((targetPct - currentPct).toFixed(1)); // +ve = under-allocated

    // Each ETF's fair monthly share = category budget ÷ number of ETFs in that category
    const monthlyTargetAmount = Math.round(
      ((targetPct / 100) * monthlyBudget) /
        (categoryCount[data.category] || 1)
    );

    rows.push({
      symbol,
      name: data.name,
      category: data.category,
      changePct: data.changePct,
      zone: data.zone,
      price: data.price,
      currentAllocation: `${currentPct}%`,
      targetAllocation: `${targetPct}%`,
      allocationGap: `${gap >= 0 ? "+" : ""}${gap}%`, // +ve = needs buying
      monthlyTargetAmount: `₹${monthlyTargetAmount}`, // fair share of ₹15k/month
    });
  }

  return rows;
}

async function getBuySuggestions(context) {
  try {
    const rows = buildAllocationContext(
      context.holdings,
      context.market,
      context.allocation
    );

    const silverMax = context.allocation?.maxAllocationPercent?.silverMax ?? 10;

    const prompt = `
You are a disciplined ETF dip-buy execution engine for an Indian investor.

GOAL:
- Invest ₹15,000/month across ETFs per their target allocation.
- Each ETF has a monthlyTargetAmount — its fair share of ₹15,000.
- On any given day, distribute available cash across ALL qualifying ETFs
  in proportion to their monthlyTargetAmount.
- Do NOT put all cash into one ETF when multiple ETFs qualify.

QUALIFICATION RULES (an ETF qualifies for buying if ALL of the below are true):
1. zone is "DIP" or "CRASH" (changePct ≤ 0%)
2. allocationGap is positive (ETF is below its target allocation)
3. For SILVERBEES only: currentAllocation must be below ${silverMax}%

CASH DISTRIBUTION (when multiple ETFs qualify):
- Split daily cash ₹${context.cash} proportionally by monthlyTargetAmount
- Example: Gold monthlyTarget ₹1125, NIFTY monthlyTarget ₹3375 → Gold gets 25%, NIFTY gets 75% of cash
- Minimum buy = 1 unit (price × 1). Skip an ETF if its share can't afford even 1 unit.
- If cash is very tight and only 1 ETF can be bought, prioritise by:
  score = |changePct| × (1 + numericAllocationGap / 100)
  Bigger dip + bigger gap = higher priority.

QUANTITY:
- qty must be a whole number (ETFs trade in units, not fractions)
- amount = qty × price
- Do not exceed the ETF's proportional cash share by more than 1 unit rounding

ETF STATUS TODAY:
${JSON.stringify(rows, null, 2)}

Cash available today: ₹${context.cash}

Respond ONLY in RAW JSON. No markdown, no explanation, no text outside JSON:
{
  "buy": [
    { "symbol": "...", "qty": 1, "price": 224.98, "amount": 224.98, "reason": "..." }
  ],
  "skip": ["symbol1", "symbol2"]
}`;

    // Opus 5.5 notes: temperature/top_p are removed (400 if sent) and thinking is always on,
    // so depth is controlled with effort. max_tokens includes thinking tokens - keep headroom.
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    });

    if (res.stop_reason === "refusal") {
      throw new Error("model refused the request (" + (res.stop_details?.category || "unknown") + ")");
    }
    if (res.stop_reason === "max_tokens") {
      throw new Error("reply cut off at max_tokens");
    }

    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    log("Claude buy suggestion (" + MODEL + "): " + text);

    const parsed = extractJson(text);
    return {
      buy: Array.isArray(parsed.buy) ? parsed.buy : [],
      skip: Array.isArray(parsed.skip) ? parsed.skip : [],
    };
  } catch (err) {
    error("Claude suggestion failed", err.message);
    // `error` lets the scan tell you the AI step failed instead of reporting "No buy today".
    return { buy: [], skip: [], error: err.message };
  }
}

module.exports = { getBuySuggestions, buildAllocationContext };

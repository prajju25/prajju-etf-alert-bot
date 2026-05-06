/**
 * Hard guardrail check — last line of defence after GPT's decision.
 * Blocks any buy that would push an ETF's category over its max allocation.
 *
 * GPT is now allocation-aware via the prompt, so this should rarely fire.
 * It exists as a safety net in case GPT hallucinates or ignores the rules.
 */
function violatesGuardrail(etf, holdings, totalInvested, rules) {
  if (!totalInvested || totalInvested === 0) return false;

  const holding = holdings[etf.symbol];
  if (!holding) return false;

  const pct = (holding.invested / totalInvested) * 100;
  const limits = rules.maxAllocationPercent;

  // Silver hard cap (subset of commodity)
  if (etf.name === "SILVERBEES" && pct >= limits.silverMax) return true;

  // Per-category caps
  const categoryLimit = {
    core: limits.core,
    sector: limits.sector,
    global: limits.global,
    commodity: limits.commodity,
  };

  const limit = categoryLimit[etf.category];
  if (limit !== undefined && pct >= limit) return true;

  return false;
}

module.exports = { violatesGuardrail };

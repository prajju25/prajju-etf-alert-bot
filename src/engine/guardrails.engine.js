function violatesGuardrail(etf, holdings, totalInvested, rules) {
  const holding = holdings[etf.symbol];
  if (!holding || totalInvested === 0) return false;

  const pct = (holding.invested / totalInvested) * 100;

  if (etf.name === "SILVER" && pct > rules.maxAllocationPercent.silverMax)
    return true;

  if (
    etf.category === "commodity" &&
    pct > rules.maxAllocationPercent.commodity
  )
    return true;

  return false;
}

module.exports = { violatesGuardrail };

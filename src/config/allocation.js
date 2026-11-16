module.exports = {
  monthlyBudget: 15000,
  dailyBase: 750,

  maxAllocationPercent: {
    core: 45,       // NIFTY + NEXT50
    sector: 10,     // HealthETF (was 20%, freed 10% moved to commodity)
    global: 20,     // Nasdaq
    commodity: 25,  // Gold + Silver combined (was 15%, +5% gold +5% silver)
    silverMax: 13,  // Silver hard cap (~half of 25% commodity with small buffer)
  },

  dipRules: {
    crash: -2,
    normal: 0,
    skipAbove: 1,
  },

  // Dip-tier sizing (see src/engine/sizing.engine.js). An ETF that is down by
  // at least minDrop% spends mult x its slice of the daily budget:
  // 0-1% = 0.5x, 1-2% = 1x, 2-3% = 2x, 3%+ = 3x.
  buyTiers: [
    { minDrop: 0, mult: 0.5 },
    { minDrop: 1, mult: 1 },
    { minDrop: 2, mult: 2 },
    { minDrop: 3, mult: 3 },
  ],
  // Total spend on one day is capped at this many times the fair daily budget.
  dayCapMult: 3,
};

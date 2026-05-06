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
};

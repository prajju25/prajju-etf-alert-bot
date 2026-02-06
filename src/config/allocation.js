module.exports = {
  monthlyBudget: 15000,
  dailyBase: 750,

  maxAllocationPercent: {
    core: 45, // NIFTY + NEXT50
    sector: 20, // Pharma
    global: 20, // Nasdaq
    commodity: 15, // Gold + Silver combined
    silverMax: 10, // Silver hard cap
  },

  dipRules: {
    crash: -2,
    normal: 0,
    skipAbove: 1,
  },
};

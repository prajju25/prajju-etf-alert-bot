/**
 * Mutable allocation state.
 *
 * Starts from the hard-coded defaults in allocation.js.
 * The Telegram listener can call update() to change maxAllocationPercent,
 * and the change is reflected in every market scan from that point on.
 *
 * monthlyBudget, dailyBase, and dipRules are not changeable at runtime —
 * they require a code deploy.
 */
const base = require("./allocation");

// Deep-copy so mutations don't touch the require cache
let state = {
  monthlyBudget: base.monthlyBudget,
  dailyBase: base.dailyBase,
  dipRules: { ...base.dipRules },
  maxAllocationPercent: { ...base.maxAllocationPercent },
};

/** Returns the current full allocation object (same shape as allocation.js). */
function get() {
  return state;
}

/**
 * Replaces maxAllocationPercent with the given values.
 * @param {object} newMaxAlloc - e.g. { core:40, sector:15, global:20, commodity:25, silverMax:13 }
 */
function update(newMaxAlloc) {
  state = {
    ...state,
    maxAllocationPercent: { ...newMaxAlloc },
  };
}

module.exports = { get, update };

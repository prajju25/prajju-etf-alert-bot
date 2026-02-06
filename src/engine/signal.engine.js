function getZone(changePct, rules) {
  if (changePct > rules.dipRules.skipAbove) return "SKIP";
  if (changePct <= rules.dipRules.crash) return "CRASH";
  if (changePct <= rules.dipRules.normal) return "DIP";
  return "WAIT";
}

module.exports = { getZone };

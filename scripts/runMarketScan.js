require("dotenv").config();
const { runMarketScan } = require("../src/jobs/marketScan");
const { log } = require("../src/utils/logger");
const { waitUntil3PMIST } = require("../src/utils/time");

async function main() {
  log(
    "Waiting for 3PM IST. Current Time: " +
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  await waitUntil3PMIST();
  runMarketScan();
}

main();

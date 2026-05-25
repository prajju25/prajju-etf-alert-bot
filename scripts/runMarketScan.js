require("dotenv").config();
const { runMarketScan } = require("../src/jobs/marketScan");
const { log } = require("../src/utils/logger");

// No waiting. GitHub Actions is scheduled at 3 PM IST directly.
// waitUntil3PMIST() was keeping runners alive for 2 hours → consuming
// 2,500 min/month vs the 2,000 min free limit → causing 3-hour queuing delays.
log(
  "Market Scan triggered. Current Time: " +
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
);

runMarketScan();

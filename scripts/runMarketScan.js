require("dotenv").config();
const { runMarketScan } = require("../src/jobs/marketScan");

runMarketScan();

require("dotenv").config();
const { runDailySavings } = require("../src/jobs/dailySavings");

runDailySavings();

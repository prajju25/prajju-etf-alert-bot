require("dotenv").config();
const { runMonthlyReset } = require("../src/jobs/monthlyReset");

runMonthlyReset();

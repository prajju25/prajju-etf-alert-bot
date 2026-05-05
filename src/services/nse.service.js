const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { log, warn } = require("../utils/logger");

const CACHE_FILE = path.resolve(__dirname, "../../nse-holidays.json");

/**
 * Reads the local holiday cache file.
 * Returns null if the file is missing or belongs to a different year.
 */
function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    const currentYear = new Date().getFullYear();
    if (data.year !== currentYear || !Array.isArray(data.holidays) || data.holidays.length === 0) {
      warn(`NSE holiday cache is stale or empty (cached year: ${data.year}, current: ${currentYear})`);
      return null;
    }
    return data.holidays;
  } catch (err) {
    warn(`Failed to read NSE holiday cache: ${err.message}`);
    return null;
  }
}

/**
 * Writes holidays to the local cache file.
 */
function writeCache(holidays) {
  try {
    const payload = {
      year: new Date().getFullYear(),
      fetchedAt: new Date().toISOString(),
      holidays,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
    log(`NSE holiday cache written: ${holidays.length} holidays`);
  } catch (err) {
    warn(`Failed to write NSE holiday cache: ${err.message}`);
  }
}

/**
 * Fetches NSE trading holidays from the NSE API.
 * NSE requires a session cookie obtained by first hitting the homepage.
 * Returns an array of date strings in "DD-Mon-YYYY" format, e.g. ["14-Apr-2025", ...]
 */
async function fetchHolidaysFromNSE() {
  log("Fetching NSE holiday list from API...");

  // Step 1: Get session cookies from NSE homepage
  const session = await axios.get("https://www.nseindia.com/", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    timeout: 15000,
  });

  const cookies = (session.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  // Step 2: Fetch holiday master list using session cookies
  const { data } = await axios.get(
    "https://www.nseindia.com/api/holiday-master?type=trading",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.nseindia.com/",
        Cookie: cookies,
      },
      timeout: 15000,
    }
  );

  // CM = Capital Market segment (covers equity ETFs)
  const holidays = (data.CM || []).map((h) => h.tradingDate);

  if (holidays.length === 0) {
    throw new Error("NSE returned an empty holiday list");
  }

  log(`Fetched ${holidays.length} NSE trading holidays from API`);
  return holidays;
}

/**
 * Returns the list of NSE trading holidays for the current year.
 * Priority: local cache file → NSE API → empty list (fail-open).
 */
async function getHolidays() {
  const cached = readCache();
  if (cached) {
    log(`Using cached NSE holidays (${cached.length} days)`);
    return cached;
  }

  try {
    const holidays = await fetchHolidaysFromNSE();
    writeCache(holidays);
    return holidays;
  } catch (err) {
    warn(`NSE API fetch failed: ${err.message}. Assuming market is open.`);
    return []; // fail-open: do not block the bot if NSE is unreachable
  }
}

/**
 * Checks whether today (in IST) is an NSE trading holiday.
 */
async function isNSEHoliday() {
  const holidays = await getHolidays();

  // NSE date format: "14-Apr-2025"
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).replace(/ /g, "-");

  const isHoliday = holidays.includes(today);
  if (isHoliday) {
    log(`Today (${today}) is an NSE trading holiday`);
  }
  return isHoliday;
}

/**
 * Counts actual NSE trading days in a given month.
 * Excludes weekends and NSE holidays.
 * @param {number} year  - Full year, e.g. 2025
 * @param {number} month - 0-indexed month (0 = Jan, 11 = Dec)
 * @param {string[]} holidays - Array of holiday strings in "DD-Mon-YYYY" format
 */
function countTradingDaysInMonth(year, month, holidays) {
  let count = 0;
  const date = new Date(year, month, 1);

  while (date.getMonth() === month) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (!isWeekend) {
      const dateStr = date
        .toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        })
        .replace(/ /g, "-");

      if (!holidays.includes(dateStr)) {
        count++;
      }
    }

    date.setDate(date.getDate() + 1);
  }

  return count;
}

/**
 * Returns the daily savings amount for the current month.
 * = monthlyBudget ÷ actual NSE trading days this month.
 * Falls back to a safe default if calculation fails.
 * @param {number} monthlyBudget
 */
async function getDailyBudget(monthlyBudget) {
  try {
    const holidays = await getHolidays();
    const now = new Date();
    const tradingDays = countTradingDaysInMonth(
      now.getFullYear(),
      now.getMonth(),
      holidays
    );

    if (tradingDays === 0) {
      warn("Trading days count is 0 — using fallback of 20 days");
      return Math.round(monthlyBudget / 20);
    }

    const daily = Math.round(monthlyBudget / tradingDays);
    log(`This month has ${tradingDays} trading days → daily budget = ₹${daily}`);
    return daily;
  } catch (err) {
    warn(`getDailyBudget failed: ${err.message} — using fallback`);
    return Math.round(monthlyBudget / 20);
  }
}

module.exports = { isNSEHoliday, getDailyBudget, getHolidays };

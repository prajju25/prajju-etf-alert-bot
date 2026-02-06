const { google } = require("googleapis");
const { error, log } = require("../utils/logger");
const { nowIST } = require("../utils/time");

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.SHEET_ID;

/* ================= GET HOLDINGS ================= */

async function getHoldings() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Holdings!A2:E",
    });

    const holdings = {};
    (res.data.values || []).forEach(([name, symbol, invested, qty]) => {
      holdings[symbol] = {
        name,
        invested: Number(invested),
        qty: Number(qty),
      };
    });

    log(
      `Fetched holdings from Google Sheets: ${Object.keys(holdings).join(", ")}`,
    );

    return holdings;
  } catch (err) {
    error("Google Sheets read failed", err.message);
    throw err;
  }
}

/* ================= WRITE TRANSACTION ================= */
async function writeTransaction({ symbol, qty, price, amount, mode }) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Transactions!A2:F",
      valueInputOption: "RAW",
      requestBody: {
        values: [[nowIST(), symbol, qty, price, amount, mode]],
      },
    });

    log(`Transaction written for ${symbol}`);
  } catch (err) {
    error("Transaction write failed", err.message);
  }
}

/* ================= UPDATE HOLDINGS ================= */
async function updateHoldings(symbol, qty, amount) {
  try {
    const holdings = await getHoldings();

    const h = holdings[symbol] || { name: symbol, qty: 0, invested: 0 };

    const newQty = h.qty + qty;
    const newInvested = h.invested + amount;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Holdings!A2:E`,
      valueInputOption: "RAW",
      requestBody: {
        values: Object.entries({
          ...holdings,
          [symbol]: { name: h.name, qty: newQty, invested: newInvested },
        }).map(([s, v]) => [v.name, s, v.invested, v.qty, nowIST()]),
      },
    });

    log(`Holdings updated for ${symbol}`);
  } catch (err) {
    error("Holdings update failed", err.message);
  }
}

module.exports = {
  getHoldings,
  writeTransaction,
  updateHoldings,
};

const axios = require("axios");
const { error, log } = require("../utils/logger");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  error("Telegram env variables missing");
}

/* ---------------- TELEGRAM SAFE SEND ---------------- */
async function sendMessageAlerts(message) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const res = await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    log("📲 Telegram alert sent");
    log("Message: " + res.data);
  } catch (err) {
    error("Telegram send failed:", err.response?.data || err.message);
  }
}

module.exports = { sendMessageAlerts };

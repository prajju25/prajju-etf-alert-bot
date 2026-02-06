const twilio = require("twilio");
const { error, log } = require("../utils/logger");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

/* ---------------- WHATSAPP SAFE SEND ---------------- */
async function sendWhatsApp(message) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: process.env.YOUR_WHATSAPP_NUMBER,
      body: message,
    });
    log("📲 WhatsApp alert sent");
  } catch (err) {
    error("WhatsApp send failed:", err.message);
  }
}

module.exports = { sendWhatsApp };

/**
 * Two-way Telegram communication.
 *
 * Uses long-polling (getUpdates) — no webhook setup needed.
 * Only accepts messages from TELEGRAM_CHAT_ID for security.
 *
 * Supported commands:
 *   /allocation          — show current allocation %
 *   /set core=40 ...     — propose a change (with confirmation)
 *   yes / no             — confirm or cancel a pending change
 *   /help                — show available commands
 */
const axios = require("axios");
const { get: getAllocation, update: updateAllocation } = require("../config/dynamicAllocation");
const { saveAllocationConfig } = require("./sheets.service");
const { log, warn, error } = require("../utils/logger");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);

// Pending confirmation: { chatId, proposed }
let pending = null;

/* ─── Telegram API helpers ──────────────────────────────────────────────── */

async function sendReply(chatId, text) {
  await axios.post(
    "https://api.telegram.org/bot" + TOKEN + "/sendMessage",
    { chat_id: chatId, text, parse_mode: "Markdown" },
    { timeout: 10000 }
  );
}

/* ─── Formatting ────────────────────────────────────────────────────────── */

function formatAlloc(maxAlloc) {
  const keys = ["core", "sector", "global", "commodity", "silverMax"];
  return keys.map((k) => "- " + k + ": " + (maxAlloc[k] ?? "?") + "%").join("\n");
}

function allocationSummary(current, proposed) {
  const keys = ["core", "sector", "global", "commodity", "silverMax"];
  let lines = "";
  for (const k of keys) {
    const oldVal = current[k];
    const newVal = proposed[k] !== undefined ? proposed[k] : oldVal;
    const changed = proposed[k] !== undefined && proposed[k] !== oldVal;
    const tag = changed ? " (" + (newVal > oldVal ? "+" : "") + (newVal - oldVal) + "%)" : " (unchanged)";
    lines += "- " + k + ": " + oldVal + "% -> " + newVal + "%" + tag + "\n";
  }
  return lines;
}

/* ─── Validation ────────────────────────────────────────────────────────── */

function validate(current, proposed) {
  const merged = { ...current, ...proposed };
  const mainKeys = ["core", "sector", "global", "commodity"];
  const total = mainKeys.reduce((s, k) => s + (merged[k] || 0), 0);
  if (total !== 100) {
    return "core + sector + global + commodity must equal 100% (got " + total + "%)";
  }
  if (merged.silverMax !== undefined && merged.silverMax > merged.commodity) {
    return "silverMax (" + merged.silverMax + "%) cannot exceed commodity (" + merged.commodity + "%)";
  }
  return null;
}

/* ─── Command handlers ──────────────────────────────────────────────────── */

async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  if (chatId !== ALLOWED_CHAT_ID) return; // ignore unknown senders

  const text = (msg.text || "").trim();
  if (!text) return;

  const lower = text.toLowerCase();
  const alloc = getAllocation();
  const current = alloc.maxAllocationPercent;

  /* ── yes / no: confirm or cancel pending change ── */
  if (pending && pending.chatId === chatId) {
    if (lower === "yes" || lower === "confirm") {
      const merged = { ...current, ...pending.proposed };
      updateAllocation(merged);
      try {
        await saveAllocationConfig(merged);
        await sendReply(chatId,
          "*Allocation updated and saved!*\n\n" + formatAlloc(merged) + "\n\nTakes effect from next market scan."
        );
      } catch (err) {
        await sendReply(chatId,
          "*Allocation updated in memory* (Sheets save failed: " + err.message + ")\nWill reset on redeploy."
        );
      }
      pending = null;
      return;
    }
    if (lower === "no" || lower === "cancel") {
      pending = null;
      await sendReply(chatId, "Cancelled. Allocation unchanged.");
      return;
    }
  }

  /* ── /allocation — show current ── */
  if (lower === "/allocation" || lower === "/status") {
    await sendReply(chatId,
      "*Current Allocation:*\n\n" + formatAlloc(current)
    );
    return;
  }

  /* ── /help or /start ── */
  if (lower === "/help" || lower === "/start") {
    await sendReply(chatId,
      "*ETF Bot Commands:*\n\n" +
      "/allocation — view current allocation\n" +
      "/set core=45 sector=10 global=20 commodity=25 silverMax=13 — propose changes\n" +
      "yes / no — confirm or cancel a pending change\n\n" +
      "_Note: core + sector + global + commodity must total 100%_"
    );
    return;
  }

  /* ── /set core=40 sector=15 ... ── */
  if (lower.startsWith("/set ") || lower.startsWith("set ")) {
    const raw = text.replace(/^\/?(set)\s+/i, "");
    const pairs = raw.split(/\s+/);
    const proposed = {};

    for (const pair of pairs) {
      const [key, val] = pair.split("=");
      if (!key || val === undefined) {
        await sendReply(chatId, "Bad format. Use: `/set core=45 sector=10 global=20 commodity=25`");
        return;
      }
      const num = Number(val);
      if (isNaN(num) || num < 0 || num > 100) {
        await sendReply(chatId, "Invalid value for " + key + ": " + val);
        return;
      }
      proposed[key.trim()] = num;
    }

    if (Object.keys(proposed).length === 0) {
      await sendReply(chatId, "Usage: `/set core=45 sector=10 global=20 commodity=25 silverMax=13`");
      return;
    }

    const validationError = validate(current, proposed);
    if (validationError) {
      await sendReply(chatId, "Cannot apply change: " + validationError);
      return;
    }

    const summary = allocationSummary(current, proposed);
    pending = { chatId, proposed };

    await sendReply(chatId,
      "*Proposed allocation change:*\n\n" + summary +
      "\nReply *yes* to confirm or *no* to cancel."
    );
    return;
  }

  /* ── unrecognised ── */
  await sendReply(chatId, "Unknown command. Send /help for the list of commands.");
}

/* ─── Polling loop ──────────────────────────────────────────────────────── */

let offset = 0;

async function poll() {
  if (!TOKEN) {
    warn("TELEGRAM_BOT_TOKEN not set — Telegram listener disabled");
    return;
  }

  log("Telegram listener started — send /help to the bot for commands");

  while (true) {
    try {
      const res = await axios.get(
        "https://api.telegram.org/bot" + TOKEN + "/getUpdates",
        {
          params: { offset, timeout: 25, allowed_updates: ["message"] },
          timeout: 30000,
        }
      );

      for (const update of res.data.result) {
        offset = update.update_id + 1;
        if (update.message) {
          await handleMessage(update.message).catch((e) =>
            error("Listener handle error", e.message)
          );
        }
      }
    } catch (err) {
      // Ignore timeout noise; back off on real errors
      if (!err.message?.includes("timeout") && !err.code?.includes("ETIMEDOUT")) {
        warn("Telegram poll error: " + err.message);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function startTelegramListener() {
  poll(); // fire-and-forget background loop
}

module.exports = { startTelegramListener };

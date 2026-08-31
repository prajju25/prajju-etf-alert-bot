/**
 * Two-way Telegram communication.
 *
 * Uses long-polling (getUpdates) — no webhook setup needed.
 * Only accepts messages from TELEGRAM_CHAT_ID for security.
 *
 * Supported commands:
 *   /holdings            — current positions, qty, live value
 *   /pnl                 — profit & loss per ETF and overall
 *   /cash                — uninvested cash pool
 *   /gainers             — today's movers across the ETF universe
 *   /target              — allocation vs target (what the buy engine sees)
 *   /scan                — run a market-scan preview now (no Sheet writes)
 *   /allocation          — show current allocation %
 *   /set core=40 ...     — propose a change (with confirmation)
 *   yes / no             — confirm or cancel a pending change
 *   /help                — show available commands
 */
const axios = require("axios");
const { get: getAllocation, update: updateAllocation } = require("../config/dynamicAllocation");
const { saveAllocationConfig, getHoldings, getDailyCash } = require("./sheets.service");
const { fetchETFs } = require("./yahoo.service");
const { buildAllocationContext } = require("./gpt.service");
const { getZone } = require("../engine/signal.engine");
const { runMarketScan } = require("../jobs/marketScan");
const ETFs = require("../config/etfs");
const { log, warn, error } = require("../utils/logger");

// category -> "NIFTYBEES & NEXT50IETF", derived from the ETF config so it
// stays in sync if ETFs are added/removed.
const CATEGORY_ETFS = ETFs.reduce((acc, e) => {
  (acc[e.category] = acc[e.category] || []).push(e.name);
  return acc;
}, {});

// symbol -> full ETF config row ({ name, symbol, category })
const SYMBOL_META = ETFs.reduce((acc, e) => {
  acc[e.symbol] = e;
  return acc;
}, {});

// Human label shown next to each allocation key.
function keyLabel(k) {
  if (k === "silverMax") return "SILVERBEES cap";
  return (CATEGORY_ETFS[k] || []).join(" & ");
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);

// Pending confirmation: { chatId, proposed }
let pending = null;

// Guards /scan against overlapping runs (each scan is ~15s of Yahoo + GPT).
let scanRunning = false;

/* ─── Telegram API helpers ──────────────────────────────────────────────── */

async function sendReply(chatId, text) {
  await axios.post(
    "https://api.telegram.org/bot" + TOKEN + "/sendMessage",
    { chat_id: chatId, text, parse_mode: "Markdown" },
    { timeout: 10000 }
  );
}

// "typing…" indicator while a command does its Sheets + Yahoo round-trip.
async function sendTyping(chatId) {
  try {
    await axios.post(
      "https://api.telegram.org/bot" + TOKEN + "/sendChatAction",
      { chat_id: chatId, action: "typing" },
      { timeout: 10000 }
    );
  } catch (e) {}
}

/* ─── Formatting ────────────────────────────────────────────────────────── */

// Rs.1,23,456 (Indian grouping), rounded to whole rupees.
function inr(n) {
  return "Rs." + Math.round(n || 0).toLocaleString("en-IN");
}

// +Rs.1,234 / -Rs.1,234 — signed, for P&L amounts.
function signedInr(n) {
  const r = Math.round(n || 0);
  return (r >= 0 ? "+" : "-") + "Rs." + Math.abs(r).toLocaleString("en-IN");
}

// +4.98% / -1.20%
function pct(n) {
  const v = Number(n || 0);
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function formatAlloc(maxAlloc) {
  const keys = ["core", "sector", "global", "commodity", "silverMax"];
  return keys
    .map((k) => {
      const label = keyLabel(k);
      const suffix = label ? " (" + label + ")" : "";
      return "- " + k + suffix + ": " + (maxAlloc[k] ?? "?") + "%";
    })
    .join("\n");
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

/* ─── Portfolio (holdings + live prices) ────────────────────────────────── */

/**
 * Joins Sheet holdings with live Yahoo quotes into one enriched view.
 *
 * @returns {Promise<{rows: object[], totalInvested: number, totalValue: number,
 *                     totalPnl: number, totalPnlPct: number}>}
 */
async function buildPortfolio() {
  const holdings = await getHoldings();
  const symbols = Object.keys(holdings);

  if (symbols.length === 0) {
    return { rows: [], totalInvested: 0, totalValue: 0, totalPnl: 0, totalPnlPct: 0 };
  }

  const quotes = await fetchETFs(symbols);

  let totalInvested = 0;
  let totalValue = 0;

  const rows = symbols.map((sym) => {
    const h = holdings[sym];
    const price = quotes[sym]?.price ?? 0;
    const dayPct = quotes[sym]?.changePct ?? 0;
    const value = price * h.qty;
    const avg = h.qty ? h.invested / h.qty : 0;
    const pnl = value - h.invested;
    const pnlPct = h.invested ? (pnl / h.invested) * 100 : 0;

    totalInvested += h.invested;
    totalValue += value;

    return {
      symbol: sym,
      name: h.name || SYMBOL_META[sym]?.name || sym,
      category: SYMBOL_META[sym]?.category || "?",
      qty: h.qty,
      invested: h.invested,
      avg,
      price,
      dayPct,
      value,
      pnl,
      pnlPct,
    };
  });

  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : 0;

  return { rows, totalInvested, totalValue, totalPnl, totalPnlPct };
}

function formatHoldings(p, cash) {
  if (p.rows.length === 0) return "*Holdings*\n\nNo holdings yet.";

  let out = "*Holdings*\n";
  for (const r of p.rows) {
    out +=
      "\n*" + r.name + "* (" + r.category + ")\n" +
      "- Qty " + r.qty + " | Avg " + inr(r.avg) + " | LTP " + inr(r.price) + " (" + pct(r.dayPct) + ")\n" +
      "- Invested " + inr(r.invested) + " -> Value " + inr(r.value) + "\n";
  }

  out +=
    "\n*Totals*\n" +
    "- Invested: " + inr(p.totalInvested) + "\n" +
    "- Value: " + inr(p.totalValue) + "\n";
  if (cash !== null && cash !== undefined && !Number.isNaN(cash)) {
    out += "- Cash pool: " + inr(cash) + "\n";
    out += "- Net worth: " + inr(p.totalValue + cash) + "\n";
  }
  return out;
}

function formatPnl(p) {
  if (p.rows.length === 0) return "*Profit & Loss*\n\nNo holdings yet.";

  let out = "*Profit & Loss*\n\n";
  for (const r of p.rows) {
    out += "*" + r.name + "*: " + signedInr(r.pnl) + " (" + pct(r.pnlPct) + ")\n";
  }

  out +=
    "\n*Overall*\n" +
    "- Invested: " + inr(p.totalInvested) + "\n" +
    "- Current: " + inr(p.totalValue) + "\n" +
    "- P&L: " + signedInr(p.totalPnl) + " (" + pct(p.totalPnlPct) + ")\n";
  return out;
}

/* ─── Universe (all configured ETFs + live quote + dip zone) ────────────── */

/**
 * Live quote + dip zone for every ETF in the config (not just held ones).
 * Shape matches what gpt.service.buildAllocationContext() expects for `market`.
 */
async function buildMarket(allocation) {
  const quotes = await fetchETFs(ETFs.map((e) => e.symbol));
  const market = {};
  for (const etf of ETFs) {
    const q = quotes[etf.symbol] || { price: 0, changePct: 0 };
    market[etf.symbol] = {
      price: q.price,
      changePct: q.changePct,
      zone: getZone(q.changePct, allocation),
      name: etf.name,
      category: etf.category,
    };
  }
  return market;
}

function formatGainers(market) {
  const rows = Object.values(market).sort((a, b) => b.changePct - a.changePct);
  let out = "*Today's Movers*\n\n";
  for (const r of rows) {
    out += "- " + r.name + ": " + pct(r.changePct) + " | " + inr(r.price) + " | " + r.zone + "\n";
  }
  return out;
}

function formatTargets(rows) {
  let out = "*Allocation vs Target*\n_what the buy engine sees_\n\n";
  for (const r of rows) {
    out +=
      "*" + r.name + "* (" + r.category + ")\n" +
      "- Now " + r.currentAllocation + " | Target " + r.targetAllocation + " | Gap " + r.allocationGap + "\n" +
      "- Zone " + r.zone + " | Day " + pct(r.changePct) + " | Fair/mo " + String(r.monthlyTargetAmount).replace("₹", "Rs.") + "\n\n";
  }
  return out;
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

  /* ── /holdings — positions + live value ── */
  if (lower === "/holdings" || lower === "/positions") {
    await sendTyping(chatId);
    try {
      const p = await buildPortfolio();
      let cash = null;
      try { cash = await getDailyCash(); } catch (e) { /* show without cash */ }
      await sendReply(chatId, formatHoldings(p, cash));
    } catch (err) {
      await sendReply(chatId, "Could not load holdings: " + err.message);
    }
    return;
  }

  /* ── /pnl — profit & loss ── */
  if (lower === "/pnl" || lower === "/pl") {
    await sendTyping(chatId);
    try {
      const p = await buildPortfolio();
      await sendReply(chatId, formatPnl(p));
    } catch (err) {
      await sendReply(chatId, "Could not compute P&L: " + err.message);
    }
    return;
  }

  /* ── /cash — uninvested cash pool ── */
  if (lower === "/cash") {
    try {
      const cash = await getDailyCash();
      await sendReply(chatId, "*Cash pool*\n\nUninvested: " + inr(cash));
    } catch (err) {
      await sendReply(chatId, "Could not read cash pool: " + err.message);
    }
    return;
  }

  /* ── /gainers — today's movers across all configured ETFs ── */
  if (lower === "/gainers" || lower === "/movers") {
    await sendTyping(chatId);
    try {
      const market = await buildMarket(getAllocation());
      await sendReply(chatId, formatGainers(market));
    } catch (err) {
      await sendReply(chatId, "Could not fetch movers: " + err.message);
    }
    return;
  }

  /* ── /target — allocation vs target, mirrors the GPT decision context ── */
  if (lower === "/target" || lower === "/targets") {
    await sendTyping(chatId);
    try {
      const allocation = getAllocation();
      const holdings = await getHoldings();
      const market = await buildMarket(allocation);
      const rows = buildAllocationContext(holdings, market, allocation);
      await sendReply(chatId, formatTargets(rows));
    } catch (err) {
      await sendReply(chatId, "Could not compute targets: " + err.message);
    }
    return;
  }

  /* ── /scan — run a market-scan PREVIEW now (never writes to Sheets) ── */
  if (lower === "/scan" || lower === "/preview") {
    if (scanRunning) {
      await sendReply(chatId, "A scan is already running — give it a few seconds.");
      return;
    }
    scanRunning = true;
    await sendReply(chatId, "Running market scan preview (no Sheet writes) — result in ~15s...");
    try {
      await runMarketScan({ dryRun: true });
    } catch (err) {
      await sendReply(chatId, "Scan failed: " + err.message);
    } finally {
      scanRunning = false;
    }
    return;
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
      "/holdings — current positions, qty, live value\n" +
      "/pnl — profit & loss per ETF and overall\n" +
      "/cash — uninvested cash pool\n" +
      "/gainers — today's movers across all ETFs\n" +
      "/target — allocation vs target (buy-engine view)\n" +
      "/scan — run a market-scan preview now (no Sheet writes)\n" +
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

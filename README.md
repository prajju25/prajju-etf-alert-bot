# 📉 ETF Dip-Buy Alert Bot (India)

A **Node.js–based ETF investment assistant** that follows a **buy-the-dip strategy** and sends **daily buy/skip alerts at 3:00 PM IST** via **Telegram**.

This bot **does NOT place trades automatically**.  
It provides **clear, disciplined buy recommendations** so you can execute manually on platforms like **Groww / Zerodha / Kite**.

---

## 🎯 Objective

- Invest **₹15,000 per month** in ETFs
- Buy **only on dips or normal accumulation zones**
- Avoid overheated (+1% or more) days
- Respect **allocation guardrails**
- Track investments in **Google Sheets**
- Size every buy with a **paced, tier-based algorithm** (no LLM, fully deterministic)

---

## 🧠 Strategy Overview (Dip-Buy Logic)

The bot follows these principles:

- ✅ Buy when:
  - Daily change ≤ +1%
  - ETF is in dip or normal zone
  - Allocation is below target
- ❌ Skip when:
  - ETF is heated (> +1%)
  - Allocation already full
  - No meaningful dip signal
- 💤 Some days → **NO BUY**
- 📉 Some days → **1–2 ETFs only**

This avoids:

- Chasing rallies
- Overbuying commodities
- Emotional investing

---

## 🔄 Daily Execution Flow (3:00 PM IST)

Every trading day, the bot performs:

1. **Fetch ETF prices**
   - Source: Yahoo Finance
   - Data:
     - Current Price
     - Previous Close
     - % Change

2. **Read investment data**
   - Source: Google Sheets
   - Data:
     - ETF quantities
     - Invested amounts
     - Target allocations

3. **Size the buys (paced, dip-tiered)**
   - Inputs:
     - Market data
     - Holdings
     - Remaining monthly budget
     - Allocation guardrails
     - Dip-buy rules
   - Output:
     - What to BUY
     - How much amount / qty
     - What to SKIP and why

4. **Send Telegram alert**
   - Final buy/skip decision
   - Reasoning included
   - Triggered at **3 PM IST**

5. **(Optional – LIVE mode)**
   - Update Google Sheet with new purchases

---

## 📊 ETFs Covered (Configurable)

Typical ETFs used:

- NIFTYBEES (Nifty 50)
- ICICI Next 50 ETF
- ICICI Pharma ETF
- MON100 (Nasdaq 100)
- GoldBees
- SilverBees

ETF list and allocation rules are **config-driven**, not hardcoded.

---

## 🏗 System Architecture

┌────────────┐
│ Yahoo │ → currentPrice, prevClose
└────┬───────┘
│
┌────▼────────┐
│ Google │ → current holdings, qty, invested amount
│ Sheets API │
└────┬────────┘
│
┌────▼────────────┐
│ Sizing engine │ → Buy / Skip / Quantity
│ Dip Strategy │
└────┬────────────┘
│
┌────▼────────────┐
│ Telegram Bot │ → Alert at 3 PM IST
└─────────────────┘

## Buy sizing algorithm (src/engine/sizing.engine.js)

1. **Daily budget** B = (cash pool + daily saving x (trading days left - 1)) / trading days left.
   A day with no buy raises tomorrow's B; unspent cash carries forward, including into the next month (no monthly reset).
2. **ETF slice** = B x (ETF monthly target / sum of targets). Only an ETF that is itself in a dip spends its slice.
3. **Dip tier** multiplies the slice: 0-1% drop = 0.5x, 1-2% = 1x, 2-3% = 2x, 3%+ = 3x (config: `buyTiers` in src/config/allocation.js).
4. **Quantity** = round(spend / price); 0 means the money stays in the pool. Total per day is capped at min(pool, 3 x B).
5. An ETF must also have a positive allocation gap and pass the category / silver caps.

## Telegram Alerts

📉 ETF DIP BUY UPDATE – 3:00 PM IST

BUY:
✅ NIFTYBEES — ₹750 (1 unit)
Reason: -0.8% dip, under-allocated

SKIP:
⏸ GoldBees (heated)
⏸ SilverBees (already heavy)

Mode: LIVE

## ⚙️ Setup Instructions

1️⃣ Clone & Install: npm install
2️⃣ .env Configuration
Create a .env file: # Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

    # Google Sheets
    SHEET_ID=

    # RUN MODE
    # DRY_RUN = no sheet update, alerts only
    # LIVE    = updates Google Sheet after buy
    RUN_MODE=LIVE

3️⃣ Google Sheets Credentials
Create a Google Service Account and download credentials.json

## 👨‍💻 Author

Built with ❤️ by Prajwal
Software Developer | Automation enthusiast

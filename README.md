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
- Use **ChatGPT** for intelligent, rule-based decisions

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

3. **Ask ChatGPT for decision**
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
│ ChatGPT (LLM) │ → Buy / Skip / Amount decision
│ Dip Strategy │
└────┬────────────┘
│
┌────▼────────────┐
│ Telegram Bot │ → Alert at 3 PM IST
└─────────────────┘

## 🤖 Role of ChatGPT

ChatGPT is used as a **decision engine**, not a predictor.

It receives structured input and responds in strict JSON:
{
"buy": [
{
"symbol": "NIFTYBEES.NS",
"amount": 750,
"reason": "Price is -0.8% and allocation below target"
}
],
"skip": [
"GOLDBEES.NS",
"SILVERBEES.NS"
]
}

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

    # ChatGPT
    OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
    GPT_MODEL=gpt-4o-mini
    GPT_TEMPERATURE=0.2
    GPT_MAX_TOKENS=500

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

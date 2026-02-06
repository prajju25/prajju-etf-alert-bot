const OpenAI = require("openai");
const { error, log } = require("../utils/logger");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getBuySuggestions(context) {
  try {
    const prompt = `
You are an ETF dip-buy execution engine.

Rules:
- Buy only if daily change ≤ 0%
- NEVER buy if ETF is above +1%
- Prefer Core > Global > Sector > Commodity
- Prefer NIFTYBEES & NEXT50
- Avoid over-allocating Silver
- Monthly budget ₹15,000
- Daily budget ₹${context.cash}
- Use available cash fully or partially
- Goal return: >= 12–15% CAGR
- This is a dip-buy strategy

Holdings:
${JSON.stringify(context.holdings, null, 2)}

Market:
${JSON.stringify(context.market, null, 2)}

Cash: ₹${context.cash}

Respond ONLY in RAW JSON format:
{
  "buy": [
    { "symbol": "...", "qty": 1, "price":224.98, "amount": 500, "reason": "..." }
  ],
  "skip": ["..."]
}
  
Male sure to follow the format strictly like below:
Return RAW JSON ONLY
No markdown
No explanation
No text before or after JSON`;

    const res = await openai.chat.completions.create({
      model: process.env.GPT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: Number(process.env.GPT_TEMPERATURE),
      max_tokens: Number(process.env.GPT_MAX_TOKENS),
    });

    log(
      "GPT buy suggestion fetched successfully: " +
        res.choices[0].message.content,
    );

    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    error("GPT suggestion failed", err.message);
    return { buy: [], skip: [] };
  }
}

module.exports = { getBuySuggestions };

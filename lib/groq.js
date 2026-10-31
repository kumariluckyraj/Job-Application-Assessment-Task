import Groq from "groq-sdk";

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Agent (tool calling)
export const MODEL = "openai/gpt-oss-120b";
// Resume parsing + job re-ranking: a separate model has its own rate-limit bucket
export const LIGHT_MODEL = "openai/gpt-oss-20b";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// chat call that waits and retries when Groq returns 429 (rate limit)
export async function groqChat(params, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await groq.chat.completions.create(params);
    } catch (e) {
      if (e?.status !== 429 || attempt >= retries) throw e;
      const m = /try again in ([\d.]+)\s*(ms|s)/i.exec(String(e?.message ?? ""));
      const base = m ? parseFloat(m[1]) * (m[2].toLowerCase() === "ms" ? 1 : 1000) : 3000;
      const wait = Math.min(base + 500, 9000);
      console.warn(`Groq rate limit hit, waiting ${Math.round(wait)}ms (attempt ${attempt + 1})`);
      await sleep(wait);
    }
  }
}
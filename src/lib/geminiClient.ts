import { GoogleGenAI } from '@google/genai';

// Read the API key LAZILY at call time — process.env is populated by Next.js
// at startup, but module-level constants can capture values before .env.local
// is loaded (especially during hot-reload or edge cases).
export const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[geminiClient] GEMINI_API_KEY is not defined in environment variables.');
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// ─── Deterministic Generation Config ─────────────────────────────────────────
// Forces greedy sampling (temperature 0), narrow nucleus (topP 0.1), and a
// fixed seed so that identical inputs produce identical outputs — zero variance
// across repeated Gemini calls.
export const DETERMINISTIC_CONFIG = {
  temperature: 0.0,
  topP: 0.1,
  seed: 42,
} as const;

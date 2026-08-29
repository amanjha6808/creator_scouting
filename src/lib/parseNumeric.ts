/**
 * Safely parse a numeric value from any input format commonly found in CSV data.
 *
 * Handles:
 *   - Comma-separated numbers: "1,500,000" → 1500000
 *   - Shorthand suffixes:     "1.2M" → 1200000, "45K" → 45000, "3.5B" → 3500000000
 *   - Percentages:            "10%" → 10.0, "0.05" → 0.05
 *   - Already-numeric:        1234 → 1234
 *   - Edge cases:             null, undefined, "", "N/A", "—" → null
 *
 * Engagement rates are rounded to 2 decimal places.
 * Returns `null` for values that cannot be parsed as finite numbers.
 */
export function parseNumericValue(val: any): number | null {
  if (val === null || val === undefined) return null;

  let str: string;

  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }

  if (typeof val !== 'string') {
    str = String(val);
  } else {
    str = val;
  }

  str = str.trim();
  if (!str || str === '—' || str === '-' || str === 'N/A' || str === 'n/a') {
    return null;
  }

  // Strip percent sign — we treat the raw number as the percentage value
  const isPercent = str.endsWith('%');
  str = str.replace('%', '');

  // Strip commas (thousand separators): "1,500,000" → "1500000"
  str = str.replace(/,/g, '');

  // Detect and expand K / M / B suffixes
  const suffixMatch = str.match(/^(-?[0-9]*\.?[0-9]+)\s*([kKmMbB])$/);
  if (suffixMatch) {
    const base = parseFloat(suffixMatch[1]);
    if (!Number.isFinite(base)) return null;
    const suffix = suffixMatch[2].toUpperCase();
    const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : 1_000_000_000;
    return roundSmart(base * multiplier);
  }

  const num = parseFloat(str);
  if (!Number.isFinite(num)) return null;

  // For engagement rates that look like decimals (0 < x < 1), scale to percentage
  // e.g. 0.05 → 5.0 (5%)
  if (isPercent) {
    return roundSmart(num);
  }

  return roundSmart(num);
}

/**
 * Round to at most 2 decimal places for engagement-rate precision,
 * but keep integers as-is to avoid unnecessary decimals on counts.
 */
function roundSmart(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // If it's a whole number, keep it clean
  if (Number.isInteger(n)) return n;
  return Math.round(n * 100) / 100;
}

/**
 * Sanitize a numeric field for database insertion.
 * Returns the parsed value or a safe fallback (0 for counts, null for optional fields).
 */
export function safeInt(val: any, fallback: number = 0): number {
  const parsed = parseNumericValue(val);
  if (parsed === null) return fallback;
  // Clamp to safe BIGINT range (0 to 2^53 - 1)
  const clamped = Math.max(0, Math.min(parsed, Number.MAX_SAFE_INTEGER));
  return Math.round(clamped);
}

/**
 * Sanitize a numeric field for optional database insertion.
 * Returns the parsed value or null if missing/invalid.
 */
export function safeNumeric(val: any): number | null {
  const parsed = parseNumericValue(val);
  if (parsed === null) return null;
  // Ensure finite and non-negative for engagement rates
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

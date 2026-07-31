// Detect quota/rate-limit upstream errors and extract reset timing.
// Used by the account-fallback loop to decide: wait for reset, or
// rotate to the next proxy pool (IP-based free-tier limits).

// A known reset within this window → don't burn a proxy; the client gets
// Retry-After instead and the limit resolves on its own.
export const LIMIT_RESET_PATIENCE_MS = 10 * 60 * 1000;

const LIMIT_WORD = /\b(rate\s*limit|too\s*many\s*requests|quota|limit\s*(reached|exceeded)|usage\s*(limit|exceeded)|capacity)\b/i;

// Patterns that carry a concrete reset moment:
const ISO_TS = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
const RESET_KEYWORD_TS = /\b(?:resets?\s*(?:at|on|in)|available\s*(?:again)?\s*(?:at|in|on)|try\s+again\s*(?:at|in)|until)\s+(\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[^.\s]*)/i;
const RELATIVE_DURATION = /\b(?:retry\s+after|try\s+again\s+in|resets?\s+in|back\s+in)\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours)\b/i;

function parseDurationToMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit.startsWith("s")) return n * 1000;
  if (unit.startsWith("m")) return n * 60 * 1000;
  if (unit.startsWith("h")) return n * 60 * 60 * 1000;
  return null;
}

function parseTimeToTodayMs(timeStr) {
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  const d = new Date();
  d.setHours(h, m, s, 0);
  // If the given time already passed, it means tomorrow.
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * @param {number} status - HTTP status from upstream
 * @param {string} message - error text
 * @param {number} [resetsAtMs] - executor-provided precise reset (codex etc.)
 * @returns {{ isLimit: boolean, resetsAtMs: number|null, retryAfterSec: number|null, willResetSoon: boolean }}
 */
export function parseLimitResetInfo(status, message, resetsAtMs) {
  const text = typeof message === "string" ? message : "";
  const isLimit =
    status === 429 ||
    (status === 403 && LIMIT_WORD.test(text)) ||
    LIMIT_WORD.test(text);

  let parsedMs = null;
  let retryAfterSec = null;

  if (resetsAtMs && Number.isFinite(resetsAtMs)) {
    parsedMs = resetsAtMs;
  } else if (isLimit && text) {
    // 1) keyword + ISO timestamp
    const kw = text.match(RESET_KEYWORD_TS);
    if (kw) {
      const raw = kw[1];
      if (/^\d{1,2}:\d{2}/.test(raw)) {
        parsedMs = parseTimeToTodayMs(raw);
      } else {
        const t = Date.parse(raw);
        if (Number.isFinite(t)) parsedMs = t;
      }
    }
    // 2) bare ISO timestamp (e.g. resets_at:"2026-07-31T12:00:00Z")
    if (!parsedMs) {
      const iso = text.match(ISO_TS);
      if (iso) {
        const t = Date.parse(iso[1]);
        if (Number.isFinite(t)) parsedMs = t;
      }
    }
    // 3) relative duration ("retry after 30 seconds")
    if (!parsedMs) {
      const rel = text.match(RELATIVE_DURATION);
      if (rel) {
        const ms = parseDurationToMs(rel[1], rel[2]);
        if (ms) parsedMs = Date.now() + ms;
      }
    }
    if (parsedMs) retryAfterSec = Math.max(Math.ceil((parsedMs - Date.now()) / 1000), 1);
  }

  return {
    isLimit,
    resetsAtMs: parsedMs,
    retryAfterSec,
    willResetSoon: isLimit && parsedMs !== null && parsedMs - Date.now() < LIMIT_RESET_PATIENCE_MS,
  };
}

// Error signatures that mean the PROXY (not the upstream) is broken — the
// request never reached the provider, so retrying through another pool is
// safe and pointless to lock the account for. Includes undici's generic
// "TypeError: fetch failed" (cause carries the real code like ECONNREFUSED).
const TRANSPORT_PATTERNS = [
  /ECONNREFUSED/i, /ECONNRESET/i, /ETIMEDOUT/i, /EHOSTUNREACH/i, /ENETUNREACH/i,
  /EPIPE/i, /ENOTFOUND/i, /EAI_AGAIN/i, /socket hang up/i, /getaddrinfo/i,
  /tunnel/i, /proxy/i, /407/i, /fetch failed/i, /UND_ERR/i, /aborted/i, /timed out/i,
];

export function isProxyTransportError(status, message) {
  if (status === 407) return true;
  if (typeof message !== "string" || !message) return false;
  return TRANSPORT_PATTERNS.some((re) => re.test(message));
}

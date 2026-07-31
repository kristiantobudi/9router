// Fail-open notification delivery: generic webhook (JSON POST) + optional
// Telegram bot message. Never throws — any error just drops the event.
import { getSettings } from "@/lib/localDb";

// Same event type is delivered at most once per window (prevents spam when
// the quota poller re-detects exhaustion every tick).
const RATE_LIMIT_MS = 30 * 60 * 1000;
const lastSent = new Map(); // rateKey → last timestamp

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getConfig(settings) {
  const cfg = settings?.notificationConfig || {};
  return {
    enabled:
      cfg.enabled === true ||
      !!(process.env.NINE_ROUTER_NOTIFY_WEBHOOK || process.env.NINE_ROUTER_TELEGRAM_BOT_TOKEN),
    webhookUrl:
      trim(cfg.webhookUrl) || trim(process.env.NINE_ROUTER_NOTIFY_WEBHOOK),
    telegramBotToken:
      trim(cfg.telegramBotToken) || trim(process.env.NINE_ROUTER_TELEGRAM_BOT_TOKEN),
    telegramChatId:
      trim(cfg.telegramChatId) || trim(process.env.NINE_ROUTER_TELEGRAM_CHAT_ID),
  };
}

export async function notifyEvent({ type, title, message, rateKey = null }) {
  try {
    const settings = await getSettings();
    const cfg = getConfig(settings);
    if (!cfg.enabled) return;

    const key = rateKey || type;
    const now = Date.now();
    if (lastSent.has(key) && now - lastSent.get(key) < RATE_LIMIT_MS) return;
    lastSent.set(key, now);

    const payload = { type, title, message, timestamp: new Date().toISOString() };

    if (cfg.webhookUrl) {
      await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }

    if (cfg.telegramBotToken && cfg.telegramChatId) {
      await fetch(
        `https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: cfg.telegramChatId,
            text: `*${title}*\n${message}`,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(8000),
        }
      ).catch(() => {});
    }
  } catch {
    // fail-open: notifications must never break quota pinging
  }
}

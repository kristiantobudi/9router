import { NextResponse } from "next/server";
import { notifyEvent } from "@/shared/services/notifier";

// POST /api/notifications/test — send a test notification through the
// configured webhook / Telegram channel.
export async function POST() {
  const { getSettings } = await import("@/lib/localDb");
  const settings = await getSettings();
  const cfg = settings?.notificationConfig || {};
  const enabled =
    cfg.enabled === true ||
    !!(process.env.NINE_ROUTER_NOTIFY_WEBHOOK || process.env.NINE_ROUTER_TELEGRAM_BOT_TOKEN);

  if (!enabled) {
    return NextResponse.json(
      { error: "Notifications are disabled — enable them in Quota page first" },
      { status: 400 }
    );
  }

  await notifyEvent({
    type: "test",
    title: "9Router test notification",
    message: "If you see this, notifications are working.",
    rateKey: `test:${Date.now()}`,
  });

  return NextResponse.json({ ok: true });
}

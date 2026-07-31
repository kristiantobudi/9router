"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const EMPTY = { enabled: false, webhookUrl: "", telegramBotToken: "", telegramChatId: "" };

export default function NotificationSettings() {
  const [cfg, setCfg] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const notify = useNotificationStore();

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.notificationConfig) {
          setCfg({ ...EMPTY, ...data.notificationConfig });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const set = (key, value) => setCfg((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationConfig: cfg }),
      });
      if (res.ok) notify.success("Notification settings saved");
      else {
        const data = await res.json().catch(() => ({}));
        notify.error(data.error || "Failed to save notification settings");
      }
    } catch {
      notify.error("Failed to save notification settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) notify.success("Test notification sent");
      else notify.error(data.error || "Test notification failed");
    } catch {
      notify.error("Test notification failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card title="Quota Notifications">
      <div className="flex flex-col gap-4">
        <Toggle
          checked={cfg.enabled}
          onChange={(on) => set("enabled", on)}
          label="Enable notifications"
          description="Notify when a provider quota is exhausted or a new quota window starts"
        />

        <Input
          label="Webhook URL"
          value={cfg.webhookUrl}
          onChange={(e) => set("webhookUrl", e.target.value)}
          placeholder="https://example.com/hook (JSON POST)"
          hint="Receives { type, title, message, timestamp }"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Telegram Bot Token"
            value={cfg.telegramBotToken}
            onChange={(e) => set("telegramBotToken", e.target.value)}
            placeholder="123456:ABC-DEF..."
            type="password"
          />
          <Input
            label="Telegram Chat ID"
            value={cfg.telegramChatId}
            onChange={(e) => set("telegramChatId", e.target.value)}
            placeholder="-1001234567890"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || !loaded} fullWidth={false}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={handleTest} variant="secondary" disabled={testing || !loaded}>
            {testing ? "Sending..." : "Send test"}
          </Button>
        </div>

        <p className="text-xs text-text-muted">
          Env fallbacks: NINE_ROUTER_NOTIFY_WEBHOOK, NINE_ROUTER_TELEGRAM_BOT_TOKEN,
          NINE_ROUTER_TELEGRAM_CHAT_ID. Notifications are rate-limited to avoid spam.
        </p>
      </div>
    </Card>
  );
}

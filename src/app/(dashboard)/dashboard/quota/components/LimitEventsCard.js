"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardSkeleton } from "@/shared/components";

const REFRESH_MS = 30_000;

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatReset(resetsAtMs) {
  if (!resetsAtMs) return null;
  const ms = Number(resetsAtMs);
  if (!Number.isFinite(ms)) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return "resets: " + formatTime(resetsAtMs);
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `resets in ~${mins}m`;
  return `resets in ~${Math.round(mins / 60)}h`;
}

// Free-tier providers (e.g. OpenCode Free) return FreeUsageLimitError with
// empty metadata — no reset time. The flag is almost always IP-based.
function isFreeLimitError(event) {
  const msg = event?.message || "";
  return /FreeUsageLimitError|rate limit exceeded|too many requests/i.test(msg);
}

export default function LimitEventsCard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/quota/limit-events", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setEvents(data.events || []);
    } catch {
      // silent — card is informational
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return (
    <Card
      title="Rate Limit Events"
      subtitle="429 / quota errors caught from live requests — shows whether the limit has a reset time"
    >
      {loading ? (
        <CardSkeleton />
      ) : events.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          No rate-limit events yet. They appear here the first time a provider answers with 429
          (or a quota-limit 403) — including OpenCode Free.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2">Detected</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reset</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/50">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatTime(e.detectedAt)}</td>
                  <td className="px-3 py-2">{e.provider || "unknown"}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs">{e.model || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={e.status === 429 ? "error" : "default"} size="sm">{e.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {formatReset(e.resetsAtMs) ? (
                      <span className="text-primary">{formatReset(e.resetsAtMs)}</span>
                    ) : (
                      <span className="text-text-muted">unknown</span>
                    )}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2 text-xs text-text-muted" title={e.message}>
                    {e.message}
                    {isFreeLimitError(e) && (
                      <span className="ml-1 text-warning">⚠ likely IP-flagged — use relay/residential</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <Button variant="secondary" onClick={fetchEvents} disabled={loading}>
          Refresh
        </Button>
      </div>
    </Card>
  );
}

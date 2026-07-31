"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Modal, Select } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getStatusVariant(status) {
  if (status === "success" || status === "ok" || status === "active") return "success";
  if (status === "error" || status === "failed" || status === "aborted") return "error";
  return "default";
}

function prettyJson(obj) {
  if (obj === undefined || obj === null) return "null";
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export default function RequestsPage() {
  const [details, setDetails] = useState([]);
  const [providers, setProviders] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const notify = useNotificationStore();

  const fetchRequests = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (providerFilter) params.set("provider", providerFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/requests?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setDetails(data.details || []);
        setPagination(data.pagination || {});
        if (data.providers) setProviders(data.providers);
      } else {
        notify.error(data.error || "Failed to load requests");
      }
    } catch {
      notify.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [providerFilter, statusFilter, notify]);

  useEffect(() => {
    fetchRequests(1);
  }, [fetchRequests]);

  const openDetail = async (id) => {
    try {
      const res = await fetch(`/api/requests/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setSelectedDetail(data.detail);
    } catch {
      notify.error("Failed to load request detail");
    }
  };

  const totalTokens = (tokens) => {
    const t = tokens || {};
    return (t.prompt_tokens || 0) + (t.completion_tokens || 0);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Request Logs" subtitle="Per-request routing history — latency, tokens, provider payloads">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <Select
              label="Provider"
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              options={[
                { value: "", label: "All providers" },
                ...providers.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div className="min-w-[140px]">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "", label: "All statuses" },
                { value: "success", label: "success" },
                { value: "error", label: "error" },
                { value: "aborted", label: "aborted" },
              ]}
            />
          </div>
          <Button variant="secondary" onClick={() => fetchRequests(1)} disabled={loading}>
            Refresh
          </Button>
        </div>
      </Card>

      <Card>
        {loading ? (
          <CardSkeleton />
        ) : details.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="material-symbols-outlined text-3xl text-text-muted">history</span>
            <p className="text-sm text-text-muted">No requests recorded.</p>
            <p className="text-xs text-text-muted">
              Request details are captured when observability is enabled (settings.enableObservability2,
              or env OBSERVABILITY_ENABLED != false). Requests already in flight from older builds may not appear.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">TTFT</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => openDetail(d.id)}
                    className="cursor-pointer border-b border-border/50 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatTime(d.timestamp)}</td>
                    <td className="px-3 py-2">{d.provider || "unknown"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs">{d.model || "unknown"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={getStatusVariant(d.status)} size="sm">{d.status || "unknown"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{d.latency?.ttft ? `${d.latency.ttft}ms` : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{d.latency?.total ? `${d.latency.total}ms` : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs">{totalTokens(d.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-xs text-text-muted">
              Page {pagination.page} / {pagination.totalPages} · {pagination.totalItems} requests
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={pagination.page <= 1 || loading}
                onClick={() => fetchRequests(pagination.page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                disabled={!pagination.hasNext || loading}
                onClick={() => fetchRequests(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selectedDetail && (
        <Modal
          isOpen={!!selectedDetail}
          onClose={() => setSelectedDetail(null)}
          title={`Request · ${selectedDetail.provider || "unknown"} / ${selectedDetail.model || "unknown"}`}
        >
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap gap-2 text-xs text-text-muted">
              <Badge variant={getStatusVariant(selectedDetail.status)} size="sm">{selectedDetail.status}</Badge>
              <span>{formatTime(selectedDetail.timestamp)}</span>
              {selectedDetail.latency?.total && <span>total {selectedDetail.latency.total}ms</span>}
              {selectedDetail.latency?.ttft && <span>ttft {selectedDetail.latency.ttft}ms</span>}
              <span>tokens {totalTokens(selectedDetail.tokens)}</span>
            </div>
            {["request", "providerRequest", "providerResponse", "response"].map((key) => (
              <div key={key}>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">{key}</div>
                <pre className="max-h-64 overflow-auto rounded bg-black/5 p-2 text-[11px] leading-relaxed dark:bg-white/5">
                  {prettyJson(selectedDetail[key])}
                </pre>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Badge from "./Badge";
import Button from "./Button";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (use selected pools)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

export default function NoAuthProxyCard({ providerId }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [selectedPoolIds, setSelectedPoolIds] = useState([]);
  const [draftPoolIds, setDraftPoolIds] = useState([]);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      const bound = Array.isArray(override.proxyPoolIds) && override.proxyPoolIds.length
        ? override.proxyPoolIds
        : (override.proxyPoolId ? [override.proxyPoolId] : []);
      setSelectedPoolIds(bound);
      setDraftPoolIds(bound);
      setRotateStrategy(override.rotateStrategy || "none");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const save = useCallback(async (poolIds, strategy) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = { ...(current[providerId] || {}) };
      if (poolIds.length === 0) {
        delete override.proxyPoolIds;
        delete override.proxyPoolId;
      } else {
        override.proxyPoolIds = poolIds;
        override.proxyPoolId = poolIds[0]; // legacy single-pool field
      }
      if (strategy === "none") delete override.rotateStrategy;
      else override.rotateStrategy = strategy;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSelectedPoolIds(poolIds);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save proxy config error:", e);
    } finally {
      setSaving(false);
    }
  }, [providerId]);

  const toggleDraft = (poolId) => {
    setDraftPoolIds((prev) => prev.includes(poolId) ? prev.filter((x) => x !== poolId) : [...prev, poolId]);
  };

  const handleApply = (poolIds) => {
    setDraftPoolIds(poolIds);
    save(poolIds, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy) => {
    setRotateStrategy(newStrategy);
    save(selectedPoolIds, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">No authentication required</p>
          <p className="text-xs text-text-muted">This provider is ready to use. Route requests through a proxy pool list to bypass IP-based limits — on a rate-limit (429) the next pool in the list is tried automatically.</p>
        </div>
        {savedFlash && <Badge variant="success" size="sm">Saved</Badge>}
      </div>

      <label className="text-sm font-medium text-text-main">Proxy Pools (failover list)</label>
      <p className="text-xs text-text-muted mb-2">
        First alive pool is used. Vercel/Cloudflare/Deno relays and residential proxies are tried before
        datacenter ones; pools flagged by a recent 429 sink to the back of the list.
      </p>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border/50 p-1">
        {(proxyPools || []).length === 0 ? (
          <p className="px-3 py-2 text-xs text-text-muted">No active proxy pools yet.</p>
        ) : (
          (proxyPools || []).map((pool) => (
            <label
              key={pool.id}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={draftPoolIds.includes(pool.id)}
                onChange={() => toggleDraft(pool.id)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="min-w-0 flex-1 truncate text-text-main">{pool.name}</span>
              {pool.type !== "http" && (
                <Badge variant="default" size="sm">{pool.type}</Badge>
              )}
              {pool.isResidential === true && (
                <Badge variant="success" size="sm">residential</Badge>
              )}
              {Number(pool.limitHits || 0) > 0 && (
                <Badge variant="error" size="sm">{pool.limitHits}× limit</Badge>
              )}
            </label>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" disabled={saving} onClick={() => handleApply([])}>
          None
        </Button>
        <Button disabled={saving} onClick={() => handleApply(draftPoolIds)}>
          {saving ? "Saving..." : "Apply"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 mt-4">
        <label className="text-sm font-medium text-text-main">Rotation Strategy</label>
        <select
          value={rotateStrategy}
          onChange={(e) => handleStrategyChange(e.target.value)}
          disabled={saving}
          className="py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all disabled:opacity-50"
        >
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          {!canRotate
            ? `Need at least 2 active proxy pools for rotation.`
            : isRotation
              ? rotateStrategy === "round-robin"
                ? `Rotating through the selected pools in order (state is in-memory, resets on restart).`
                : `Picking a random pool from the selected pools each request.`
              : selectedPoolIds.length > 0
                ? `Uses the selected pools above, first alive wins.`
                : `No pools selected — requests go out directly.`}
        </p>
      </div>
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};

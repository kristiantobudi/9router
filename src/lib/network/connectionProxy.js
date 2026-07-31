import { getProxyPoolById, updateProxyPool } from "@/models";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Dead-pool cooldown (in-memory) ────────────────────────────────
// A pool that fails mid-request (transport error) is parked for this long,
// so retries pick the next pool instead of the same dead one.
const PROXY_FAIL_COOLDOWN_MS = 10 * 60 * 1000;

// poolId → cooldown-until timestamp (ms)
const failedPoolUntil = new Map();

export function getProxyPoolCooldownMs(poolId) {
  if (!poolId) return 0;
  const until = failedPoolUntil.get(poolId);
  if (!until) return 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function isPoolInCooldown(poolId) {
  return getProxyPoolCooldownMs(poolId) > 0;
}

/**
 * Mark a proxy pool as failed. Parks it in cooldown so the next pick
 * skips it (when alternatives exist) and persists the failure to the DB
 * so the dashboard shows it. Never throws.
 *
 * opts.limitHit: true when the failure was a rate-limit (429/quota) error —
 * increments the pool's limitHits counter + lastLimitAt, which demotes the
 * pool in the failover order (flagged datacenter IPs sink below relays/
 * residential/clean pools). Flags decay after LIMIT_FLAG_TTL_MS.
 */
export function markProxyPoolFailed(poolId, error = "", opts = {}) {
  if (!poolId) return;
  failedPoolUntil.set(poolId, Date.now() + PROXY_FAIL_COOLDOWN_MS);

  const update = {
    testStatus: "error",
    lastError: String(error || "Proxy failed").slice(0, 300),
    lastTestedAt: new Date().toISOString(),
  };

  if (opts.limitHit === true) {
    update.lastLimitAt = new Date().toISOString();
    update.limitHits = (Number(opts.prevLimitHits) || 0) + 1;
  }

  updateProxyPool(poolId, update).catch(() => {});
}

// How long a 429 "flag" demotes a pool before it re-joins its normal tier.
// Matches the assumption that free-tier windows are ~daily.
export const LIMIT_FLAG_TTL_MS = 24 * 60 * 60 * 1000;
const RELAY_TYPES = ["vercel", "cloudflare", "deno"];

/**
 * Priority score for pool selection. Lower = picked first.
 * 1. relay types (Vercel/Cloudflare/Deno) — proven clean egress
 * 2. residential proxies (explicitly marked in the UI)
 * 3. everything else (datacenter http/socks)
 * +10 when the pool hit a rate-limit recently (still within LIMIT_FLAG_TTL_MS)
 * → flagged datacenter pools sink below all clean pools automatically.
 */
export function getPoolPriorityScore(pool) {
  if (!pool) return 999;
  const tier = RELAY_TYPES.includes(pool.type)
    ? 0
    : pool.isResidential === true
      ? 1
      : 2;
  const hits = Number(pool.limitHits || 0);
  const lastLimitAt = pool.lastLimitAt ? new Date(pool.lastLimitAt).getTime() : 0;
  const flaggedRecently = hits > 0 && lastLimitAt > 0 && Date.now() - lastLimitAt < LIMIT_FLAG_TTL_MS;
  return tier + (flaggedRecently ? 10 : 0);
}

/**
 * Sort pool candidates by selection priority (stable — original order kept
 * within the same score). Pure function, testable.
 */
export function sortPoolCandidatesByPriority(pools) {
  return [...pools].sort((a, b) => {
    const sa = getPoolPriorityScore(a);
    const sb = getPoolPriorityScore(b);
    return sa - sb;
  });
}

// ─── Pool id helpers ───────────────────────────────────────────────
/**
 * Pool ids bound to a connection. New form is `proxyPoolIds` (array,
 * failover list); legacy `proxyPoolId` (single) still works.
 */
export function getConnectionPoolIds(providerSpecificData = {}) {
  const raw = Array.isArray(providerSpecificData?.proxyPoolIds)
    ? providerSpecificData.proxyPoolIds
    : providerSpecificData?.proxyPoolId
      ? [providerSpecificData.proxyPoolId]
      : [];
  return [...new Set(raw.map(normalizeString).filter((id) => id && id !== "__none__"))];
}

// Drop pools in cooldown; if everything is in cooldown, keep the full
// list so the caller can still attempt a (hopefully recovered) proxy.
function filterLivePools(poolIds) {
  const now = Date.now();
  const live = poolIds.filter((id) => !failedPoolUntil.has(id) || failedPoolUntil.get(id) <= now);
  return live.length > 0 ? live : poolIds;
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // rotationKey → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 * Pools in failure cooldown are skipped when alternatives exist.
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  const live = filterLivePools(poolIds);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];

  const rotationKey = `${providerId || ""}`;
  if (strategy === "round-robin") {
    const state = rotateState.get(rotationKey) || { index: -1 };
    state.index = (state.index + 1) % live.length;
    rotateState.set(rotationKey, state);
    return live[state.index];
  }

  if (strategy === "random") {
    return live[Math.floor(Math.random() * live.length)];
  }

  return live[0]; // "none" or unknown
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool (single or failover list)
 * 2. Legacy Proxy
 * 3. No Proxy
 *
 * options.excludePoolIds: Set of pool ids to skip (already failed this request).
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {},
  options = {}
) {
  try {
    const excludePoolIds =
      options?.excludePoolIds instanceof Set ? options.excludePoolIds : new Set();

    const poolIds = getConnectionPoolIds(providerSpecificData);

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (poolIds.length > 0) {
      // Drop request-excluded pools; then drop cooldown pools when an alternative remains.
      const usable = poolIds.filter((id) => !excludePoolIds.has(id));
      const live = filterLivePools(usable);
      const candidates = live.length > 0 ? live : usable;

      // Load all candidates, sort by selection priority (relays & residential
      // first, rate-limit-flagged pools last), then take the first valid one.
      const pools = [];
      for (const poolId of candidates) {
        const proxyPool = await getProxyPoolById(poolId);
        if (proxyPool) pools.push(proxyPool);
      }
      const sorted = sortPoolCandidatesByPriority(pools);

      // Try candidates in order; skip invalid ones (missing/inactive/no URL).
      for (const proxyPool of sorted) {
        const poolId = proxyPool.id;
        const proxyUrl = normalizeString(proxyPool.proxyUrl);
        const noProxy = normalizeString(proxyPool.noProxy);
        const isValidPool = proxyPool.isActive === true && proxyUrl;

        if (!isValidPool) continue;

        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type,

            proxyPoolId: poolId,
            proxyPool,
            proxyPoolCandidates: candidates.length,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId: poolId,
          proxyPool,
          proxyPoolCandidates: candidates.length,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }

      // Pools configured but none usable right now — fail through the first
      // candidate anyway so we never silently bypass the proxy.
      const fallbackId = candidates[0];
      if (fallbackId) {
        const proxyPool = await getProxyPoolById(fallbackId);
        if (proxyPool?.proxyUrl) {
          const noProxy = normalizeString(proxyPool.noProxy);
          return {
            source: "pool",
            proxyPoolId: fallbackId,
            proxyPool,
            proxyPoolCandidates: candidates.length,
            connectionProxyEnabled: true,
            connectionProxyUrl: normalizeString(proxyPool.proxyUrl),
            connectionNoProxy: noProxy,
            strictProxy: proxyPool.strictProxy === true,
          };
        }
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: poolIds[0] || null,
        proxyPoolCandidates: 0,
        proxyPool: null,

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: poolIds[0] || null,
      proxyPoolCandidates: 0,
      proxyPool: null,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}

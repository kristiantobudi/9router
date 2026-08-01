import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK } from "./config.js";

export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(url, cancelToken = { cancelled: false }) {
  return waitForHealthAny([url], cancelToken);
}

/**
 * Wait until ANY of the given URLs answers /api/health with OK.
 * Used for tunnels where the public shortlink and the direct URL may
 * become reachable at different times (worker route vs edge DNS).
 */
export async function waitForHealthAny(urls, cancelToken = { cancelled: false }) {
  const list = (urls || []).filter(Boolean);
  if (list.length === 0) throw new Error("No URLs to health-check");
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    const results = await Promise.all(list.map((u) => probeUrlAlive(u)));
    if (results.some(Boolean)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}

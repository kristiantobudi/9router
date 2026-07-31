// Self-check for proxy-pool auto-failover selection logic.
// Run: npx vitest run unit/proxy-failover.test.js
import { describe, it, expect, beforeEach } from "vitest";
import {
  getConnectionPoolIds,
  pickProxyPoolId,
  markProxyPoolFailed,
  getProxyPoolCooldownMs,
  isPoolInCooldown,
} from "@/lib/network/connectionProxy";

// markProxyPoolFailed persists to DB via @/models → swap in a no-op to keep
// this test DB-free. Vitest resolves @/lib/localDb through the alias, so we
// mock the updateProxyPool side effect indirectly by letting it fail silently
// (updateProxyPool import is lazily resolved through @/models → localDb which
// may not have a DB in test env; the .catch(() => {}) swallows that).
describe("proxy failover", () => {
  beforeEach(() => {
    // Reset module-level cooldown state between tests by re-importing.
    vi.resetModules();
  });

  it("getConnectionPoolIds: prefers proxyPoolIds array, falls back to proxyPoolId", async () => {
    const { getConnectionPoolIds: ids } = await import("@/lib/network/connectionProxy");
    expect(ids({ proxyPoolIds: ["a", "b", "a", "", "__none__"] })).toEqual(["a", "b"]);
    expect(ids({ proxyPoolId: "x" })).toEqual(["x"]);
    expect(ids({})).toEqual([]);
    expect(ids({ proxyPoolId: "__none__" })).toEqual([]);
  });

  it("pickProxyPoolId: skips pools in cooldown when alternatives exist", async () => {
    const mod = await import("@/lib/network/connectionProxy");
    const ids = ["a", "b", "c"];

    mod.markProxyPoolFailed("b", "ECONNREFUSED test");

    // round-robin over live pools only — b is parked, never picked
    const picked = new Set();
    for (let i = 0; i < 20; i++) {
      picked.add(mod.pickProxyPoolId(ids, "round-robin", "prov"));
    }
    expect(picked.has("b")).toBe(false);
    expect(picked.has("a")).toBe(true);
    expect(picked.has("c")).toBe(true);
    expect(mod.isPoolInCooldown("b")).toBe(true);
    expect(mod.getProxyPoolCooldownMs("b")).toBeGreaterThan(0);

    // all pools in cooldown → falls back to full list (still attempts)
    mod.markProxyPoolFailed("a", "x");
    mod.markProxyPoolFailed("c", "x");
    expect(mod.pickProxyPoolId(ids, "round-robin", "prov")).toBeTruthy();
  });

  it("pickProxyPoolId: single pool returns it even in cooldown", async () => {
    const mod = await import("@/lib/network/connectionProxy");
    mod.markProxyPoolFailed("solo", "x");
    expect(mod.pickProxyPoolId(["solo"], "none", "prov")).toBe("solo");
  });

  it("getConnectionPoolIds: dedupes and trims", async () => {
    const { getConnectionPoolIds: ids } = await import("@/lib/network/connectionProxy");
    expect(ids({ proxyPoolIds: [" a ", "a", "b"] })).toEqual(["a", "b"]);
  });
});

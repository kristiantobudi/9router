// Self-check for pool priority ordering (relay/residential first, flagged last).
// Run: npx vitest run unit/proxy-priority.test.js
import { describe, it, expect } from "vitest";
import { getPoolPriorityScore, sortPoolCandidatesByPriority } from "@/lib/network/connectionProxy";

const pool = (overrides) => ({ id: "p", type: "http", isActive: true, proxyUrl: "http://x:1", ...overrides });

describe("getPoolPriorityScore", () => {
  it("relays rank above residential, which rank above datacenter http", () => {
    const relay = getPoolPriorityScore(pool({ type: "vercel" }));
    const residential = getPoolPriorityScore(pool({ isResidential: true }));
    const datacenter = getPoolPriorityScore(pool({}));
    expect(relay).toBeLessThan(residential);
    expect(residential).toBeLessThan(datacenter);
  });

  it("recent rate-limit flag pushes a pool below clean ones", () => {
    const flagged = getPoolPriorityScore(pool({ limitHits: 3, lastLimitAt: new Date().toISOString() }));
    const clean = getPoolPriorityScore(pool({}));
    expect(flagged).toBeGreaterThan(clean);
  });

  it("flag decays after 24h — pool returns to its normal tier", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const staleFlag = getPoolPriorityScore(pool({ limitHits: 3, lastLimitAt: old }));
    const clean = getPoolPriorityScore(pool({}));
    expect(staleFlag).toBe(clean);
  });
});

describe("sortPoolCandidatesByPriority", () => {
  it("orders: relay, residential, clean http, flagged http", () => {
    const flaggedHttp = pool({ id: "f", limitHits: 5, lastLimitAt: new Date().toISOString() });
    const cleanHttp = pool({ id: "c" });
    const relay = pool({ id: "r", type: "deno" });
    const residential = pool({ id: "h", isResidential: true });

    const sorted = sortPoolCandidatesByPriority([flaggedHttp, cleanHttp, relay, residential]).map((p) => p.id);
    expect(sorted).toEqual(["r", "h", "c", "f"]);
  });

  it("stable within the same score (keeps input order)", () => {
    const a = pool({ id: "a" });
    const b = pool({ id: "b" });
    const sorted = sortPoolCandidatesByPriority([b, a]).map((p) => p.id);
    expect(sorted).toEqual(["b", "a"]);
  });
});

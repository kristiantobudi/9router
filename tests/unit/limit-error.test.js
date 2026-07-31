// Self-check for rate-limit detection + reset-time parsing.
// Run: npx vitest run unit/limit-error.test.js
import { describe, it, expect } from "vitest";
import { parseLimitResetInfo, LIMIT_RESET_PATIENCE_MS, isProxyTransportError } from "open-sse/utils/limitError.js";

describe("parseLimitResetInfo", () => {
  it("429 is always a limit error", () => {
    const r = parseLimitResetInfo(429, "something happened");
    expect(r.isLimit).toBe(true);
    expect(r.willResetSoon).toBe(false);
  });

  it("403 only with limit words", () => {
    expect(parseLimitResetInfo(403, "You have exceeded your quota. Please try again later.").isLimit).toBe(true);
    expect(parseLimitResetInfo(403, "Invalid API key provided.").isLimit).toBe(false);
  });

  it("parses ISO reset timestamp from message", () => {
    const r = parseLimitResetInfo(429, "Rate limit reached. Resets at 2030-01-02T03:04:05Z");
    expect(r.isLimit).toBe(true);
    expect(r.resetsAtMs).toBe(Date.parse("2030-01-02T03:04:05Z"));
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("parses relative duration (retry after N minutes)", () => {
    const before = Date.now();
    const r = parseLimitResetInfo(429, "Too many requests. Retry after 5 minutes.");
    expect(r.isLimit).toBe(true);
    expect(r.resetsAtMs).not.toBeNull();
    expect(r.resetsAtMs - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
    expect(r.resetsAtMs - before).toBeLessThan(5 * 60 * 1000 + 2000);
  });

  it("parses clock-time reset (resets at 09:30)", () => {
    const r = parseLimitResetInfo(429, "Rate limited. Try again at 09:30:00");
    expect(r.isLimit).toBe(true);
    expect(r.resetsAtMs).not.toBeNull();
    const d = new Date(r.resetsAtMs);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it("respects executor-provided resetsAtMs", () => {
    const ts = Date.parse("2031-05-05T00:00:00Z");
    const r = parseLimitResetInfo(429, "whatever", ts);
    expect(r.resetsAtMs).toBe(ts);
  });

  it("willResetSoon true when reset within patience window", () => {
    const r = parseLimitResetInfo(429, "Limit reached. Try again in 60 seconds");
    expect(r.isLimit).toBe(true);
    expect(r.willResetSoon).toBe(true);
    expect(r.resetsAtMs - Date.now()).toBeLessThan(LIMIT_RESET_PATIENCE_MS);
  });

  it("not a limit for 500 or transport errors", () => {
    expect(parseLimitResetInfo(500, "Internal server error").isLimit).toBe(false);
    expect(parseLimitResetInfo(0, "connect ECONNREFUSED 1.2.3.4:80").isLimit).toBe(false);
  });
});

describe("isProxyTransportError", () => {
  it("recognizes explicit transport codes", () => {
    expect(isProxyTransportError(0, "connect ECONNREFUSED 1.2.3.4:3129")).toBe(true);
    expect(isProxyTransportError(0, "fetch failed")).toBe(true);
    expect(isProxyTransportError(0, "TypeError: fetch failed (cause: UND_ERR_SOCKET)")).toBe(true);
    expect(isProxyTransportError(0, "This operation was aborted")).toBe(true);
    expect(isProxyTransportError(0, "request timed out")).toBe(true);
    expect(isProxyTransportError(407, "")).toBe(true);
  });

  it("does not misclassify upstream errors", () => {
    expect(isProxyTransportError(429, "Rate limit exceeded. Please try again later.")).toBe(false);
    expect(isProxyTransportError(500, "Internal server error")).toBe(false);
    expect(isProxyTransportError(401, "Invalid API key")).toBe(false);
    expect(isProxyTransportError(0, null)).toBe(false);
  });
});

// Self-check for Retry-After header capture in upstream error parsing.
// Run: npx vitest run unit/retry-after.test.js
import { describe, it, expect } from "vitest";
import { parseRetryAfterHeader, parseUpstreamError } from "open-sse/utils/error.js";

describe("parseRetryAfterHeader", () => {
  it("parses seconds", () => {
    const before = Date.now();
    const ms = parseRetryAfterHeader(new Response(null, { headers: { "retry-after": "120" } }));
    expect(ms).not.toBeNull();
    expect(ms - before).toBeGreaterThanOrEqual(119_000);
    expect(ms - before).toBeLessThan(121_000);
  });

  it("parses HTTP-date", () => {
    const date = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfterHeader(new Response(null, { headers: { "retry-after": date } }));
    expect(ms).not.toBeNull();
    expect(Math.abs(ms - Date.now() - 60_000)).toBeLessThan(5000);
  });

  it("returns null when absent or malformed", () => {
    expect(parseRetryAfterHeader(new Response(null))).toBeNull();
    expect(parseRetryAfterHeader(new Response(null, { headers: { "retry-after": "garbage" } }))).toBeNull();
  });
});

describe("parseUpstreamError", () => {
  it("carries Retry-After into resetsAtMs and parses JSON body", async () => {
    const before = Date.now();
    const res = new Response(
      JSON.stringify({ error: { message: "Rate limit exceeded" } }),
      { status: 429, headers: { "retry-after": "60", "content-type": "application/json" } }
    );
    const parsed = await parseUpstreamError(res);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.message).toBe("Rate limit exceeded");
    expect(parsed.resetsAtMs).not.toBeNull();
    expect(parsed.resetsAtMs - before).toBeGreaterThanOrEqual(59_000);
    expect(parsed.resetsAtMs - before).toBeLessThan(61_000);
  });

  it("executor resetsAtMs wins over header", async () => {
    const exact = Date.parse("2032-01-01T00:00:00Z");
    const res = new Response("boom", { status: 429, headers: { "retry-after": "120" } });
    const executor = { parseError: () => ({ status: 429, message: "custom", resetsAtMs: exact }) };
    const parsed = await parseUpstreamError(res, executor);
    expect(parsed.resetsAtMs).toBe(exact);
  });

  it("no header → resetsAtMs null", async () => {
    const parsed = await parseUpstreamError(new Response("plain text", { status: 500 }));
    expect(parsed.statusCode).toBe(500);
    expect(parsed.message).toContain("plain text");
    expect(parsed.resetsAtMs).toBeNull();
  });
});

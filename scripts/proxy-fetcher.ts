#!/usr/bin/env npx tsx
/**
 * Proxy Fetcher & Checker — CLI
 *
 * Fetches raw proxy data, formats to http://user:pass@ip:port/,
 * tests each proxy via httpbin.org/ip with 5s timeout,
 * keeps only HTTP-200 valid proxies.
 *
 * Usage:
 *   npx tsx scripts/proxy-fetcher.ts
 *   npx tsx scripts/proxy-fetcher.ts --timeout 8000 --output my-proxies.txt
 *   npx tsx scripts/proxy-fetcher.ts --source https://api.myproxyprovider.com/list
 */

// ─── Config ───────────────────────────────────────────────────────────────────

interface Config {
  /** URL to fetch raw proxy data from (placeholder) */
  apiUrl: string;
  /** Test endpoint to verify proxy works */
  testUrl: string;
  /** Per-proxy timeout in ms */
  timeout: number;
  /** Output file path */
  outputFile: string;
  /** Max concurrent checks */
  concurrency: number;
}

const DEFAULT_CONFIG: Config = {
  apiUrl: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  testUrl: "https://httpbin.org/ip",
  timeout: 5_000,
  outputFile: "valid_proxies.txt",
  concurrency: 20,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawProxy {
  ip: string;
  port: string | number;
  username?: string;
  password?: string;
}

interface ProxyResult {
  raw: RawProxy;
  url: string;
  valid: boolean;
  latency?: number;
  error?: string;
}

// ─── Fetch: get raw proxy lines ───────────────────────────────────────────────

async function fetchRawProxies(apiUrl: string): Promise<string[]> {
  const res = await fetch(apiUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "curl/8.0" },
  });

  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

// ─── Parse: line → RawProxy ──────────────────────────────────────────────────

function parseProxyLine(line: string): RawProxy | null {
  // Already formatted: http://user:pass@ip:port
  const urlMatch = line.match(
    /^https?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)/,
  );
  if (urlMatch) {
    return {
      username: decodeURIComponent(urlMatch[1]),
      password: decodeURIComponent(urlMatch[2]),
      ip: urlMatch[3],
      port: urlMatch[4],
    };
  }

  // ip:port:user:pass
  const colonMatch = line.match(/^([^:]+):(\d+):([^:]+):(.+)$/);
  if (colonMatch) {
    return {
      ip: colonMatch[1],
      port: colonMatch[2],
      username: colonMatch[3],
      password: colonMatch[4],
    };
  }

  // ip:port
  const simpleMatch = line.match(/^([^:]+):(\d+)$/);
  if (simpleMatch) {
    return { ip: simpleMatch[1], port: simpleMatch[2] };
  }

  return null;
}

// ─── Format: RawProxy → proxy URL string ─────────────────────────────────────

function formatProxyUrl(proxy: RawProxy): string {
  let url = "http://";
  if (proxy.username && proxy.password) {
    url += `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`;
  }
  url += `${proxy.ip}:${proxy.port}/`;
  return url;
}

// ─── Checker: test single proxy ──────────────────────────────────────────────

async function checkProxy(
  proxyUrl: string,
  testUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; latency: number }> {
  const start = performance.now();

  const { ProxyAgent } = await import("undici");

  const proxyAgent = new ProxyAgent({
    uri: proxyUrl.replace(/\/$/, ""),
    requestTimeout: timeoutMs,
    connectTimeout: Math.min(timeoutMs, 3_000),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(testUrl, {
      method: "GET",
      // @ts-expect-error - undici dispatcher type quirk
      dispatcher: proxyAgent,
      signal: controller.signal,
      headers: { "User-Agent": "curl/8.0" },
    });

    const latency = Math.round(performance.now() - start);
    return { ok: res.ok, latency };
  } catch {
    const latency = Math.round(performance.now() - start);
    return { ok: false, latency };
  } finally {
    clearTimeout(timer);
    proxyAgent.close?.();
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const cfg: Config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--source":
      case "--api-url":
        cfg.apiUrl = args[++i];
        break;
      case "--test-url":
        cfg.testUrl = args[++i];
        break;
      case "--timeout":
        cfg.timeout = parseInt(args[++i], 10) || DEFAULT_CONFIG.timeout;
        break;
      case "--output":
        cfg.outputFile = args[++i];
        break;
      case "--concurrency":
        cfg.concurrency = parseInt(args[++i], 10) || DEFAULT_CONFIG.concurrency;
        break;
      case "--help":
        console.log(`
Usage: npx tsx scripts/proxy-fetcher.ts [options]

Options:
  --source <url>       Proxy list URL (default: SpeedX public list)
  --test-url <url>     Endpoint to test proxies against (default: https://httpbin.org/ip)
  --timeout <ms>       Per-proxy timeout (default: 5000)
  --output <file>      Output file for valid proxies (default: valid_proxies.txt)
  --concurrency <n>    Max concurrent checks (default: 20)
  --help               Show this help
`);
        process.exit(0);
    }
  }

  console.log(`\n🔍 Proxy Fetcher`);
  console.log(`   Source     : ${cfg.apiUrl}`);
  console.log(`   Test URL   : ${cfg.testUrl}`);
  console.log(`   Timeout    : ${cfg.timeout}ms`);
  console.log(`   Concurrency: ${cfg.concurrency}`);
  console.log(`   Output     : ${cfg.outputFile}\n`);

  // Step 1: Fetch
  console.log("⬇ Fetching raw proxy list...");
  let lines: string[];
  try {
    lines = await fetchRawProxies(cfg.apiUrl);
  } catch (err: any) {
    console.error(`✖ Failed to fetch: ${err.message}`);
    process.exit(1);
  }
  console.log(`   Got ${lines.length} raw lines\n`);

  // Step 2: Parse
  console.log("🔧 Parsing & formatting...");
  const rawProxies: RawProxy[] = [];
  const parseErrors: string[] = [];

  for (const line of lines) {
    const parsed = parseProxyLine(line);
    if (parsed) rawProxies.push(parsed);
    else parseErrors.push(line);
  }

  if (parseErrors.length > 0) {
    console.log(`   ${parseErrors.length} lines skipped (unrecognised format)`);
  }
  console.log(`   ${rawProxies.length} proxies parsed\n`);

  if (rawProxies.length === 0) {
    console.log("✖ No proxies to test. Exiting.");
    process.exit(0);
  }

  // Step 3: Check
  console.log("🧪 Testing proxies...");
  const results: ProxyResult[] = [];
  let checked = 0;

  const formatted = rawProxies.map((p) => ({ raw: p, url: formatProxyUrl(p) }));

  // Worker pool
  const queue = [...formatted];
  const workers: Promise<void>[] = [];

  for (let w = 0; w < Math.min(cfg.concurrency, queue.length); w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift()!;
          const result: ProxyResult = { raw: item.raw, url: item.url, valid: false };

          const check = await checkProxy(item.url, cfg.testUrl, cfg.timeout);
          result.valid = check.ok;
          result.latency = check.latency;

          if (check.ok) {
            results.push(result);
            console.log(
              `   ✓ ${item.url}  ${check.latency}ms`,
            );
          } else {
            const reason = check.latency >= cfg.timeout ? "Timeout" : "Failed";
            console.log(`   ✗ ${item.url}  ${reason}`);
          }

          checked++;
        }
      })(),
    );
  }

  await Promise.all(workers);

  // Step 4: Output
  const valid = results.filter((r) => r.valid);
  console.log(`\n📊 Results: ${valid.length}/${checked} valid`);

  const outputPath = cfg.outputFile;
  // Try Bun first, then Node fs
  try {
    const fs = await import("fs");
    await fs.promises.writeFile(outputPath, valid.map((r) => r.url).join("\n"), "utf-8");
  } catch {
    // fallback for Bun
    const { writeFile } = await import("fs/promises");
    await writeFile(outputPath, valid.map((r) => r.url).join("\n"), "utf-8");
  }

  console.log(`💾 Saved to ${outputPath}\n`);

  if (valid.length > 0) {
    const avgLatency = Math.round(
      valid.reduce((s, r) => s + (r.latency ?? 0), 0) / valid.length,
    );
    console.log(`   Avg latency: ${avgLatency}ms`);
    console.log(`   Proxies ready for 9router import.\n`);
  }
}

main().catch((err) => {
  console.error("✖ Fatal:", err);
  process.exit(1);
});

import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";

// ─── Free proxy sources ───────────────────────────────────────────────────────
const SOURCES = [
  {
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    label: "SpeedX",
  },
  {
    url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
    label: "ShiftyTR",
  },
  {
    url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
    label: "jetkai",
  },
  {
    url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
    label: "roosterkid",
  },
];

const TEST_URL = "http://httpbin.org/ip";
const TIMEOUT = 8_000; // free proxies are slow
const CONCURRENCY = 20;
const MAX_PROXIES = 100;

// ─── Parse ────────────────────────────────────────────────────────────────────
function parseProxyLine(line) {
  const m = line.trim().match(/^([^:]+):(\d+)$/);
  return m ? { ip: m[1], port: m[2] } : null;
}

// ─── Checker ──────────────────────────────────────────────────────────────────
async function checkProxy(proxyUrl, testUrl, signal) {
  const start = performance.now();
  let agent;
  try {
    const { fetch: undiciFetch, ProxyAgent } = await import("undici");
    // Match app's ProxyAgent usage — no explicit connectTimeout
    agent = new ProxyAgent({ uri: proxyUrl.replace(/\/$/, "") });
    const res = await undiciFetch(testUrl, {
      dispatcher: agent,
      signal,
      headers: { "User-Agent": "curl/8.0" },
    });
    const latency = Math.round(performance.now() - start);
    await res.body?.cancel?.();
    return { ok: res.status === 200, latency };
  } catch (err) {
    const latency = Math.round(performance.now() - start);
    const reason = err?.cause?.code || err?.code || err?.message?.slice(0, 80) || String(err).slice(0, 80);
    return { ok: false, latency, error: reason };
  } finally {
    agent?.close?.();
  }
}

// ─── GET handler ──────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    message:
      'POST to generate & import proxies. Body: { max?: number, sources?: string[] }',
  });
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const maxProxies = Math.min(body?.max ?? MAX_PROXIES, MAX_PROXIES);
  const selectedSources = body?.sources?.length
    ? SOURCES.filter((s) => body.sources.includes(s.label.toLowerCase()))
    : SOURCES;

  if (selectedSources.length === 0) {
    return NextResponse.json({ error: "No valid sources selected" }, { status: 400 });
  }

  const logs = [];
  const log = (msg) => {
    logs.push(msg);
    console.log(`[proxy-generate] ${msg}`);
  };

  log(`Fetching from ${selectedSources.length} source(s)...`);

  // ── Step 1: Fetch all sources ─────────────────────────────────────────────
  const rawLines = [];
  for (const src of selectedSources) {
    try {
      const res = await fetch(src.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "curl/8.0" },
      });
      if (!res.ok) {
        log(`  ${src.label}: HTTP ${res.status} — skip`);
        continue;
      }
      const text = await res.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      rawLines.push(...lines);
      log(`  ${src.label}: ${lines.length} lines`);
    } catch (err) {
      log(`  ${src.label}: ${err.message} — skip`);
    }
  }

  log(`Total raw lines: ${rawLines.length}`);

  // ── Step 2: Parse ─────────────────────────────────────────────────────────
  const seen = new Set();
  const proxies = [];

  for (const line of rawLines) {
    const p = parseProxyLine(line);
    if (!p || seen.has(p.ip)) continue;
    seen.add(p.ip);
    proxies.push(p);
  }

  log(`Unique proxies parsed: ${proxies.length}`);

  if (proxies.length === 0) {
    return NextResponse.json({ error: "No proxies found", logs }, { status: 404 });
  }

  // ── Step 3: Test ──────────────────────────────────────────────────────────
  const testBatch = proxies.slice(0, Math.min(300, proxies.length));
  log(`Testing ${testBatch.length} proxies (concurrency=${CONCURRENCY}, timeout=${TIMEOUT}ms)...`);

  const queue = [...testBatch];
  const validUrls = [];
  const failures = {};
  let tested = 0;
  const testedSet = new Set();

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const p = queue.shift();
          const proxyUrl = `http://${p.ip}:${p.port}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT);
          try {
            const result = await checkProxy(proxyUrl, TEST_URL, controller.signal);
            if (result.ok) {
              validUrls.push(proxyUrl + "/");
            } else {
              const errKey = result.error || "unknown";
              failures[errKey] = (failures[errKey] || 0) + 1;
            }
          } finally {
            clearTimeout(timer);
            tested++;
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  log(`Valid: ${validUrls.length}/${tested}`);

  // Report top failure reasons
  const topFailures = Object.entries(failures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [reason, count] of topFailures) {
    log(`  fail: ${reason} — ${count}x`);
  }

  // ── Step 4: Import ────────────────────────────────────────────────────────
  const importBatch = validUrls.slice(0, maxProxies);
  let imported = 0;
  let failed = 0;

  for (const proxyUrl of importBatch) {
    try {
      const hostname = new URL(proxyUrl).hostname;
      await createProxyPool({
        name: `Generated ${hostname}`,
        proxyUrl,
        noProxy: "",
        isActive: true,
        strictProxy: false,
        type: "http",
      });
      imported++;
    } catch (err) {
      failed++;
    }
  }

  log(`Imported: ${imported}, Failed: ${failed}`);

  return NextResponse.json({
    success: true,
    imported,
    failed,
    valid: validUrls.length,
    tested,
    totalParsed: proxies.length,
    logs,
  });
}

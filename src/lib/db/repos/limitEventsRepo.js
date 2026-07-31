import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { v4 as uuidv4 } from "uuid";

// Quota/rate-limit events recorded from live request failures (429, 403 quota).
// Kept small and fire-and-forget — never throws.

const MAX_EVENTS = 200;
const DEDUPE_MS = 60 * 1000; // same provider+model+status recorded at most once/min

const lastRecorded = new Map(); // `${provider}:${model}:${status}` → timestamp

export async function recordLimitEvent({ provider, model, connectionId, status, message, resetsAtMs }) {
  try {
    const key = `${provider || "?"}:${model || "?"}:${status ?? "?"}`;
    const now = Date.now();
    if (lastRecorded.has(key) && now - lastRecorded.get(key) < DEDUPE_MS) return;
    lastRecorded.set(key, now);

    const db = await getAdapter();
    const id = uuidv4();
    const detectedAt = new Date(now).toISOString();
    const event = {
      id,
      provider: provider || null,
      model: model || null,
      connectionId: connectionId || null,
      status: Number(status) || 0,
      message: String(message || "").slice(0, 500),
      resetsAtMs: resetsAtMs || null,
      detectedAt,
    };

    db.run(
      `INSERT INTO providerLimitEvents(id, timestamp, provider, model, connectionId, status, data)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [id, detectedAt, event.provider, event.model, event.connectionId, event.status, stringifyJson(event)]
    );

    const cnt = db.get(`SELECT COUNT(*) as c FROM providerLimitEvents`);
    if (cnt && cnt.c > MAX_EVENTS) {
      db.run(
        `DELETE FROM providerLimitEvents WHERE id IN (SELECT id FROM providerLimitEvents ORDER BY timestamp ASC LIMIT ?)`,
        [cnt.c - MAX_EVENTS]
      );
    }
  } catch {
    // never throw out of the error path
  }
}

export async function getLimitEvents(limit = 50) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT data FROM providerLimitEvents ORDER BY timestamp DESC LIMIT ?`,
      [Math.min(100, Math.max(1, limit))]
    );
    return rows.map((r) => parseJson(r.data, {}));
  } catch {
    return [];
  }
}

#!/usr/bin/env node
/**
 * MarkitTick warm-service LATENCY BENCHMARK — TradingView Low-Latency Origin
 * Prep v0.1.
 *
 * Sends N warm MarkitTick alerts to a running reactor's
 * POST /api/webhooks/tradingview/markittick and reports p50/p95/max for total +
 * per-stage (ingest/mapper/scorer/persistence) + per-lane latency, read from the
 * server's own latency instrumentation block.
 *
 * Latency doctrine (reported, not promised): total ≈ ingest + max(required lane)
 * + scorer + persistence. Warm local/cached/fast providers target <150–200ms;
 * slower provider selections (live CFTC/EDGAR/Tiny-Brains) run 1–3s+, bounded by
 * the slowest REQUIRED lane.
 *
 * Env:
 *   AFI_REACTOR_URL         reactor base URL (default http://localhost:8080)
 *   MARKITTICK_BENCH_ITERS  measured iterations (default 30, + 5 warmup)
 *   AFI_MARKITTICK_SECRET   optional webhook shared secret
 *   AFI_IDENTITY_TOKEN      optional Bearer token (Cloud Run IAM)
 *   AFI_MARKITTICK_PERSIST  set on the reactor side; if "false" the reactor
 *                           excludes persistence (pure enrich+score latency)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.AFI_REACTOR_URL || "http://localhost:8080").replace(/\/$/, "");
const URL = `${BASE}/api/webhooks/tradingview/markittick`;
const ITERS = Number(process.env.MARKITTICK_BENCH_ITERS || 30);
const WARMUP = 5;
const SECRET = process.env.AFI_MARKITTICK_SECRET;
const TOKEN = process.env.AFI_IDENTITY_TOKEN;

const basePayload = JSON.parse(
  readFileSync(join(HERE, "captured-payloads", "markittick-bull-cross.json"), "utf8")
);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function summarize(name, s) {
  const a = [...s].sort((x, y) => x - y);
  return { name, p50: pct(a, 50), p95: pct(a, 95), max: a[a.length - 1] ?? 0, n: a.length };
}

async function postOne(i) {
  const payload = { ...basePayload, signalId: `bench-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}` };
  if (SECRET) payload.secret = SECRET;
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const t0 = Date.now();
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  const wallMs = Date.now() - t0;
  const body = await res.json();
  return { status: res.status, wallMs, latency: body?.latency };
}

console.log(`bench-markittick → ${URL}  (iters=${ITERS}, warmup=${WARMUP})`);
const total = [], ingest = [], mapper = [], scorer = [], persist = [], wall = [];
const lanes = {};
for (let i = 0; i < WARMUP + ITERS; i++) {
  const r = await postOne(i);
  if (r.status !== 200 || !r.latency) {
    console.error(`  ✗ iteration ${i}: HTTP ${r.status}`);
    process.exit(1);
  }
  if (i < WARMUP) continue;
  total.push(r.latency.totalLatencyMs);
  ingest.push(r.latency.ingestLatencyMs);
  mapper.push(r.latency.mapperLatencyMs);
  scorer.push(r.latency.scorerLatencyMs);
  persist.push(r.latency.persistenceLatencyMs);
  wall.push(r.wallMs);
  for (const l of r.latency.lanes || []) (lanes[l.lane] ??= []).push(l.latencyMs);
}

const rows = [
  summarize("total(server)", total),
  summarize("wall(client)", wall),
  summarize("ingest", ingest),
  summarize("mapper", mapper),
  summarize("scorer", scorer),
  summarize("persistence", persist),
  ...Object.entries(lanes).map(([k, s]) => summarize(`lane:${k}`, s)),
];
console.log(`\n  ${"stage".padEnd(16)} p50      p95      max`);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(16)} ${String(r.p50 + "ms").padEnd(8)} ${String(r.p95 + "ms").padEnd(8)} ${r.max}ms`);
}
console.log(`\n(n=${ITERS}; total(server) is the reactor-measured latency, wall(client) includes network RTT.)`);

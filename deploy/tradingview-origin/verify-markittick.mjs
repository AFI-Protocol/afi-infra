#!/usr/bin/env node
/**
 * MarkitTick captured-payload VERIFICATION — TradingView Low-Latency Origin
 * Prep v0.1.
 *
 * POSTs the captured bull_cross + bear_cross MarkitTick alerts to a running
 * reactor's POST /api/webhooks/tradingview/markittick and asserts a REAL
 * synchronous scored 200 with the latency + source instrumentation. Preflight
 * only — originMode stays "captured-preflight" until a real TradingView webhook
 * fires after the account plan upgrade.
 *
 * Env:
 *   AFI_REACTOR_URL        reactor base URL (default http://localhost:8080)
 *   AFI_MARKITTICK_SECRET  optional webhook shared secret (body.secret)
 *   AFI_IDENTITY_TOKEN     optional Bearer token (Cloud Run IAM). For the hosted
 *                          reactor: AFI_IDENTITY_TOKEN=$(gcloud auth print-identity-token)
 *
 * Usage: node verify-markittick.mjs   (exit 0 = both scored; 1 = any failure)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.AFI_REACTOR_URL || "http://localhost:8080").replace(/\/$/, "");
const URL = `${BASE}/api/webhooks/tradingview/markittick`;
const SECRET = process.env.AFI_MARKITTICK_SECRET;
const TOKEN = process.env.AFI_IDENTITY_TOKEN;

const CASES = [
  { file: "markittick-bull-cross.json", direction: "long" },
  { file: "markittick-bear-cross.json", direction: "short" },
];

function loadPayload(file) {
  const p = JSON.parse(readFileSync(join(HERE, "captured-payloads", file), "utf8"));
  if (SECRET) p.secret = SECRET;
  return p;
}

async function postOne(payload) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(URL, { method: "POST", headers, body: JSON.stringify(payload) });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { _nonJson: await res.text() };
  }
  return { status: res.status, body };
}

let failures = 0;
console.log(`verify-markittick → ${URL}`);
for (const c of CASES) {
  const { status, body } = await postOne(loadPayload(c.file));
  const uwr = body?.analystScore?.uwrScore;
  const dir = body?.origin?.direction;
  const ok =
    status === 200 &&
    typeof uwr === "number" &&
    uwr >= 0 &&
    uwr <= 1 &&
    dir === c.direction &&
    body?.origin?.source === "tradingview" &&
    body?.latency &&
    typeof body.latency.totalLatencyMs === "number";
  if (ok) {
    const lanes = (body.latency.lanes || []).map((l) => `${l.lane}=${l.latencyMs}ms/${l.status}`).join(" ");
    console.log(
      `  ✓ ${c.file}: HTTP 200 | uwrScore=${uwr} | direction=${dir} | ` +
        `origin=${body.origin.originMode} | persistence=${body?.persistence?.outcome} | ` +
        `totalLatencyMs=${body.latency.totalLatencyMs} | profile=${body.latency.selectedProfileId}\n` +
        `      lanes: ${lanes}`
    );
  } else {
    failures++;
    console.error(`  ✗ ${c.file}: HTTP ${status} — ${JSON.stringify(body).slice(0, 400)}`);
  }
}

if (failures) {
  console.error(`\nFAIL: ${failures}/${CASES.length} case(s) did not score.`);
  process.exit(1);
}
console.log(`\nPASS: both captured MarkitTick payloads scored (preflight).`);

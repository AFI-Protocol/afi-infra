// 🧩 TSSD Replay Runner (core helper, no CLI wiring)
//
// This is the minimal replay engine described in docs/TSSD_REPLAY_CLI_SPEC.v0.1.md.
// It is read-only, deterministic, and intended to be wrapped by a future CLI.
// No external network calls, no mutation of canonical TSSD history.

import type { ITSSDVaultClient as TSSDVaultClient } from "./TSSDVaultClient.js";
import type { VaultedSignalRecord } from "./types.js";

export interface TssdReplayOptions {
  signalId?: string;
  epochId?: string; // TODO: future filter
  analystId?: string; // TODO: future filter
  strategyId?: string; // TODO: future filter
  from?: string; // ISO, TODO for future implementation
  to?: string; // ISO, TODO for future implementation
  limit?: number; // safety cap, default used below
  dryRun?: boolean; // default true
  outputMode?: "json" | "ndjson" | "summary";
  scorerVersionTag?: string; // optional string to capture “version used”
}

export interface TssdReplayResult {
  totalRequested: number;
  totalReplayed: number;
  totalWithOriginalScore: number;
  totalWithoutOriginalScore: number;
  matches?: number;
  mismatches?: number;
  skipped?: number;
  notes?: string[];
}

const DEFAULT_LIMIT = 50;

/**
 * Replay signals from TSSD in a deterministic, read-only way.
 * This is a v0.1 stub: it only supports single-signal replay and does not write any audit records.
 */
export async function replaySignalsFromTssd(
  vault: TSSDVaultClient,
  options: TssdReplayOptions
): Promise<TssdReplayResult> {
  const notes: string[] = [];
  const limit = options.limit ?? DEFAULT_LIMIT;
  const dryRun = options.dryRun ?? true;

  // Bulk filters are intentionally TODO in v0.1
  if (!options.signalId) {
    notes.push("Bulk replay filters (epoch/analyst/strategy/time range) are TODO in v0.1.");
    if (dryRun) {
      notes.push("Dry run: no writes are attempted (none are implemented in v0.1).");
    }
    return {
      totalRequested: 0,
      totalReplayed: 0,
      totalWithOriginalScore: 0,
      totalWithoutOriginalScore: 0,
      notes,
    };
  }

  const signalId = options.signalId;
  const record: VaultedSignalRecord | null = await vault.getBySignalId(signalId);

  if (!record) {
    notes.push(`Signal not found: ${signalId}`);
    if (dryRun) {
      notes.push("Dry run: no writes are attempted (none are implemented in v0.1).");
    }
    return {
      totalRequested: 1,
      totalReplayed: 0,
      totalWithOriginalScore: 0,
      totalWithoutOriginalScore: 0,
      notes,
    };
  }

  // Deterministic, read-only handling of a single record
  const hasScore = Boolean(record.stages?.scored);
  const totalWithOriginalScore = hasScore ? 1 : 0;
  const totalWithoutOriginalScore = hasScore ? 0 : 1;

  notes.push(
    `Replayed signal ${signalId} (original score ${hasScore ? "present" : "missing"}).`
  );
  if (dryRun) {
    notes.push("Dry run: no writes are attempted (none are implemented in v0.1).");
  }
  notes.push(`Limit honored: ${limit} (single-signal replay).`);

  return {
    totalRequested: 1,
    totalReplayed: 1,
    totalWithOriginalScore,
    totalWithoutOriginalScore,
    matches: undefined,
    mismatches: undefined,
    skipped: undefined,
    notes,
  };
}

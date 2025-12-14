// 🧩 T.S.S.D. Vault Types
// Canonical, auditable, training-ready memory for each AFI signal lifecycle

import { EnrichmentCategory } from "../../schemas/enrichment_common.js";

/**
 * Lifecycle stage of a signal in the AFI Protocol.
 * Represents the progression from RAW ingestion through MINTED on-chain and REPLAYED for validation.
 */
export type SignalLifecycleStage =
  | "RAW"
  | "ENRICHED"
  | "ANALYZED"
  | "SCORED"
  | "MINTED"
  | "REPLAYED";

/**
 * Identity and context for a signal.
 * Provides globally unique identification and links to AFI's epoch/emissions system.
 */
export interface SignalIdentity {
  /** Globally unique identifier across all AFI signals */
  signalId: string;
  /** AFI Epoch ID for emissions alignment */
  epochId: string;
  /** Market identifier (e.g. "BTC-PERP", "ETH-USD") */
  market: string;
  /** Timeframe (e.g. "1m", "1h", "1d") */
  timeframe: string;
  /** Optional strategy identifier (e.g. "blofin-trend-pullback-v1") */
  strategyId?: string;
  /** Optional scout agent identifier */
  scoutId?: string;
  /** Optional analyst identifier */
  analystId?: string;
  /** Optional validator identifier */
  validatorId?: string;
}

/**
 * RAW stage snapshot: initial signal ingestion.
 * Captures the moment a signal enters the AFI system.
 */
export interface RawSignalSnapshot {
  /** ISO timestamp when signal was received */
  receivedAt: string;
  /** Source of the signal (e.g. "tradingview-webhook", "internal-model") */
  source: string;
  /** Human-readable description of what triggered this signal */
  triggerSummary: string;
  /** Optional hash of the full payload for integrity verification */
  payloadHash?: string;
}

/**
 * ENRICHED stage snapshot: signal augmented with indicators, patterns, sentiment.
 * Adds context from technical analysis, news, and other data sources.
 */
export interface EnrichmentSnapshot {
  /** ISO timestamp when enrichment was completed */
  enrichedAt: string;
  /** Optional enrichment categories applied */
  categories?: EnrichmentCategory[];
  /** Optional identifier for the enrichment agent/swarm */
  enrichedBy?: string;
  /** Technical indicators and their values */
  indicators?: Record<string, number | string>;
  /** Detected pattern labels (e.g. "head-and-shoulders", "double-bottom") */
  patterns?: string[];
  /** Sentiment tags from news/social agents */
  sentimentTags?: string[];
  /** Additional enrichment data */
  extra?: Record<string, unknown>;
}

/**
 * ANALYZED stage snapshot: high-level narrative and regime classification.
 * Provides human-interpretable analysis of the signal's meaning.
 */
export interface AnalysisSnapshot {
  /** ISO timestamp when analysis was completed */
  analyzedAt: string;
  /** High-level narrative explaining the signal's thesis */
  thesisSummary: string;
  /** Market regime tags (e.g. "trend", "range", "high-vol") */
  regimeTags?: string[];
  /** Risk classification (e.g. "low", "medium", "high") */
  riskBand?: string;
}

/**
 * Analyst Score Snapshot
 *
 * This interface mirrors AnalystScoreTemplate from afi-core/src/analyst/AnalystScoreTemplate.ts
 * and provides a compatible structure for storing analyst scoring data in TSSD vault records.
 *
 * The canonical source of truth for this structure is AnalystScoreTemplate in afi-core.
 * This interface is kept in sync with that template to ensure compatibility.
 *
 * Note: This is a storage/snapshot type. The full AnalystScoreTemplate may have additional
 * optional fields that are not required for vault persistence.
 */
export interface AnalystScoreSnapshot {
  /** Analyst identifier (e.g. "froggy", "alpha") */
  analystId: string;

  /** Strategy identifier (e.g. "trend_pullback_v1") */
  strategyId: string;

  /** Optional strategy version */
  strategyVersion?: string;

  /** Market type (e.g. "spot", "perp", "futures") */
  marketType: string;

  /** Asset class (e.g. "crypto", "forex", "equities") */
  assetClass: string;

  /** Instrument type (e.g. "spot", "linear-perp", "inverse-perp") */
  instrumentType: string;

  /** Base asset (e.g. "BTC", "ETH") */
  baseAsset: string;

  /** Quote asset (e.g. "USD", "USDT") */
  quoteAsset: string;

  /** Signal timeframe (e.g. "1m", "1h", "1d") */
  signalTimeframe: string;

  /** Holding horizon (e.g. "scalp", "swing", "position") */
  holdingHorizon: string;

  /** Trade direction */
  direction: "long" | "short" | "neutral";

  /** Risk bucket classification */
  riskBucket: "low" | "medium" | "high";

  /** Conviction level (0..1) */
  conviction: number;

  /** UWR (Universal Weighting Rule) axes */
  uwrAxes: {
    structure: number;
    execution: number;
    risk: number;
    insight: number;
  };

  /** UWR score (weighted average of axes) */
  uwrScore: number;

  /** Optional narrative fields */
  rationale?: string;
  caveats?: string;
  tags?: string[];
}

/**
 * Per-signal scoring snapshot stored in the TSSD vault.
 *
 * - analystScore is the canonical per-signal score (AnalystScoreSnapshot).
 * - PoI / PoInsight are NOT stored here; they live in agent/validator registries.
 */
export interface ScoreSnapshot {
  /** ISO timestamp when scoring was completed */
  scoredAt: string;

  /** Canonical analyst score (single source of truth) */
  analystScore: AnalystScoreSnapshot;

  /** Optional decay parameters for time-based score adjustment */
  decayParams?: {
    /** Half-life in minutes for score decay */
    halfLifeMinutes?: number;
    /** Reference to AFI's Greeks-based decay template */
    greeksTemplateId?: string;
  } | null;
}

/**
 * MINTED stage snapshot: on-chain receipt and token information.
 * Records the blockchain transaction details when signal is minted.
 */
export interface MintSnapshot {
  /** ISO timestamp when minting occurred */
  mintedAt?: string;
  /** AFI ERC-20 token contract address */
  tokenAddress?: string;
  /** ERC-1155 receipt contract address (if used) */
  receiptAddress?: string;
  /** ERC-1155 token ID (if used) */
  tokenId?: string;
  /** Transaction hash on-chain */
  txHash?: string;
  /** Chain ID (e.g. 8453 for Base mainnet) */
  chainId?: number;
}

/**
 * Public surface view: safe to expose via receipts, explorers, dashboards.
 * Contains high-level insights without revealing proprietary strategy details.
 */
export interface PublicSurfaceView {
  /** High-level factors driving the signal (no proprietary edge) */
  keyDrivers: string[];
  /** Concise, human-readable explanation */
  summaryInsight: string;
  /** Risk label (e.g. "conservative", "balanced", "aggressive") */
  riskLabel?: string;
  /** Arbitrary tags for clustering and search */
  tags?: string[];
}

/**
 * Proprietary detail view: reserved for analyst's private edge.
 * This data may remain fully private and is NOT required for AFI participation.
 */
export interface ProprietaryDetailView {
  /** Free-form notes for the analyst's internal use */
  internalNotes?: string;
  /** Description of internal features/inputs used */
  featureNotes?: string;
  /** External references (e.g. IPFS/S3 links, private docs) */
  externalRefs?: string[];
  /** Pointer to encrypted or off-vault blob */
  opaqueBlobRef?: string;
}

/**
 * Training flags: guide whether and how records are used for model training.
 * Allows analysts to control how their signals contribute to AFI's learning systems.
 */
export interface TrainingFlags {
  /** Whether to include this signal for model training (default: true if omitted) */
  includeForModel?: boolean;
  /** If true, must anonymize before training */
  anonymizeRequired?: boolean;
  /** If true, reserved for evaluation/backtest holdout set */
  holdoutSet?: boolean;
}

/**
 * Outcome snapshot: REPLAYED stage for post-signal evaluation.
 * Used by validators to assess signal performance and realized outcomes.
 */
export interface OutcomeSnapshot {
  /** ISO timestamp when outcome was resolved/evaluated */
  resolvedAt?: string;
  /** Realized percentage return */
  realizedPnlPct?: number;
  /** Maximum drawdown percentage during signal lifetime */
  maxDrawdownPct?: number;
  /** Additional notes about the outcome */
  notes?: string;
}

/**
 * VaultedSignalRecord: The CANONICAL record of a signal's full lifecycle.
 *
 * This is the single source of truth for:
 * - Signal progression through RAW → ENRICHED → ANALYZED → SCORED → MINTED → REPLAYED
 * - Public surface data (safe for receipts and explorers)
 * - Proprietary detail (optional, for analyst's private use)
 * - Training flags (controls model training inclusion)
 *
 * The Vault is the dense "brain" of AFI; on-chain receipts are the surface breadcrumbs.
 */
export interface VaultedSignalRecord {
  /** Identity and context for this signal */
  identity: SignalIdentity;

  /** Lifecycle stage snapshots */
  stages: {
    /** RAW stage: initial ingestion */
    raw?: RawSignalSnapshot;
    /** ENRICHED stage: augmented with indicators and patterns */
    enriched?: EnrichmentSnapshot;
    /** ANALYZED stage: high-level narrative and regime */
    analyzed?: AnalysisSnapshot;
    /** SCORED stage: quantitative assessment */
    scored?: ScoreSnapshot;
    /** MINTED stage: on-chain receipt */
    minted?: MintSnapshot;
    /** REPLAYED stage: outcome evaluation */
    replayed?: OutcomeSnapshot;
  };

  /** Public surface: safe to expose via receipts, explorers, dashboards */
  publicSurface: PublicSurfaceView;

  /** Proprietary detail: optional, for analyst's private edge */
  proprietaryDetail?: ProprietaryDetailView;

  /** Training flags: guide model training usage */
  training: TrainingFlags;

  /** ISO timestamp when record was created */
  createdAt: string;

  /** ISO timestamp when record was last updated */
  updatedAt: string;
}

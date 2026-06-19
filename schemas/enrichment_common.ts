import { z } from "zod";

/**
 * Canonical enrichment category vocabulary shared across AFI enrichment schemas.
 */
export enum EnrichmentCategory {
  TECHNICAL = "technical",
  PATTERN = "pattern",
  SENTIMENT = "sentiment",
  NEWS = "news",
  AI_ML = "ai_ml",
}

export const EnrichmentCategorySchema = z.nativeEnum(EnrichmentCategory);

/**
 * Core enrichment payload shape that enrichment agents (e.g., the enrichment designer)
 * and downstream analysts can rely on.
 *
 * Notes:
 * - Fields are optional/nullable to accommodate partial enrichments.
 * - Nested sections mirror existing schema concepts (indicators, pattern analysis,
 *   sentiment/news flags, AI/ML outputs).
 * - enrichmentMeta ties back to the enrichment event metadata.
 */
export interface EnrichedSignalCore {
  signalId: string;
  symbol: string;
  market: string;
  timeframe: string;

  technical?: {
    emaDistancePct?: number | null;
    isInValueSweetSpot?: boolean | null;
    brokeEmaWithBody?: boolean | null;
    indicators?: Record<string, number | null> | null;
  };

  pattern?: {
    patternName?: string | null;
    patternConfidence?: number | null;
  };

  sentiment?: {
    score?: number | null;
    tags?: string[] | null;
  };

  news?: {
    hasShockEvent?: boolean | null;
    shockDirection?: "bullish" | "bearish" | "mixed" | "none" | null;
    headlines?: string[] | null;
  };

  aiMl?: {
    ensembleScore?: number | null;
    modelTags?: string[] | null;
  };

  enrichmentMeta: {
    categories: EnrichmentCategory[];
    enrichedBy: string;
    enrichedAt: string;
  };
}

export const EnrichedSignalCoreSchema = z.object({
  signalId: z.string(),
  symbol: z.string(),
  market: z.string(),
  timeframe: z.string(),
  technical: z
    .object({
      emaDistancePct: z.number().nullable().optional(),
      isInValueSweetSpot: z.boolean().nullable().optional(),
      brokeEmaWithBody: z.boolean().nullable().optional(),
      indicators: z.record(z.number().nullable()).nullable().optional(),
    })
    .optional(),
  pattern: z
    .object({
      patternName: z.string().nullable().optional(),
      patternConfidence: z.number().nullable().optional(),
    })
    .optional(),
  sentiment: z
    .object({
      score: z.number().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
    })
    .optional(),
  news: z
    .object({
      hasShockEvent: z.boolean().nullable().optional(),
      shockDirection: z
        .enum(["bullish", "bearish", "mixed", "none"])
        .nullable()
        .optional(),
      headlines: z.array(z.string()).nullable().optional(),
    })
    .optional(),
  aiMl: z
    .object({
      ensembleScore: z.number().nullable().optional(),
      modelTags: z.array(z.string()).nullable().optional(),
    })
    .optional(),
  enrichmentMeta: z.object({
    categories: z.array(EnrichmentCategorySchema),
    enrichedBy: z.string(),
    enrichedAt: z.string(),
  }),
});

import { z } from "zod";

// 🧬 AFI Validator Metadata Schema
// Captures agent reputation & capability profile

export const ValidatorMetadataSchema = z.object({
  agentId: z.string().uuid(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  domainsCovered: z.array(z.string()), // e.g., ["futures", "macro", "onchain"]
  supportedStrategies: z.array(z.string()), // e.g., ["scalp", "swing", "news"]
  supportedMarkets: z.array(z.string()), // e.g., ["Binance", "Bybit"]
  poiScore: z.number().min(0).max(1).default(0), // Proof-of-Insight (value contribution)
  po_i_score: z.number().min(0).max(1).default(0), // Proof-of-Intelligence (domain fluency)
  epochsActive: z.number().min(0),
  mintedAFI: z.number().min(0),
  isActive: z.boolean().default(true),
  lastUpdated: z.string().datetime()
});

export type ValidatorMetadata = z.infer<typeof ValidatorMetadataSchema>;
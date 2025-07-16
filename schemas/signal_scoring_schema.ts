// 🧩 AFI Signal Scoring Schema

import { z } from "zod";

export const SignalScoringSchema = z.object({
  signalId: z.string().uuid(),
  strength: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  volatility: z.number().optional(),
  volumeSpike: z.boolean().optional(),
  aiConsensusScore: z.number().min(0).max(100).optional(),
  enrichedTags: z.array(z.string()).optional(),
  scoredAt: z.string().datetime(),
});

export type SignalScore = z.infer<typeof SignalScoringSchema>;

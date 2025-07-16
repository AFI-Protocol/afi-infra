// 🧠 AFI Signal Analysis Schema

import { z } from "zod";

export const SignalAnalysisSchema = z.object({
  signalId: z.string().uuid(),
  source: z.string(),
  market: z.string(),
  timeframe: z.string(),
  indicators: z.array(z.string()),
  technicalAnalysis: z.record(z.string(), z.any()).optional(),
  patternAnalysis: z.record(z.string(), z.any()).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  analysisSummary: z.string().optional(),
  enrichedAt: z.string().datetime().optional(),
});

export type SignalAnalysis = z.infer<typeof SignalAnalysisSchema>;

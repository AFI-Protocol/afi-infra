import { z } from "zod";

/* ---------- SCHEMA ---------- */
export const SignalEnrichmentSchema = z.object({
  signalId: z.string().uuid(),
  enrichedBy: z.string(),
  enrichedAt: z.string().datetime(),
  features: z.record(z.any()), // arbitrary key:value pairs e.g., indicators, pattern matches, etc.
  enrichmentType: z.enum(["technical", "sentiment", "news", "onchain", "custom"]),
  notes: z.string().optional(),
});

/* ---------- RUNTIME TYPE ---------- */
export type SignalEnrichment = z.infer<typeof SignalEnrichmentSchema>;

import { z } from "zod";
import {
  EnrichmentCategorySchema,
  type EnrichmentCategory
} from "./enrichment_common";

/* ---------- SCHEMA ---------- */
export const SignalEnrichmentSchema = z.object({
  signalId: z.string().uuid(),
  enrichedBy: z.string(),
  enrichedAt: z.string().datetime(),
  features: z.record(z.any()), // arbitrary key:value pairs e.g., indicators, pattern matches, etc.
  enrichmentType: EnrichmentCategorySchema.or(z.enum(["onchain", "custom"])),
  notes: z.string().optional(),
});

/* ---------- RUNTIME TYPE ---------- */
export type SignalEnrichment = z.infer<typeof SignalEnrichmentSchema>;
export type SignalEnrichmentType =
  | EnrichmentCategory
  | "onchain"
  | "custom";

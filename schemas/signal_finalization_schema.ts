// 🧩 Signal Finalization Schema

import { z } from "zod";

export const FinalizedSignalSchema = z.object({
  signalId: z.string().uuid(),
  validatorId: z.string(),
  finalizedAt: z.string().datetime(),
  validityScore: z.number().min(0).max(100),
  metadata: z.record(z.any()).optional(),
});

export type FinalizedSignal = z.infer<typeof FinalizedSignalSchema>;

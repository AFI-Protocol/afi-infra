import { z } from "zod";

export const SignalVariantType = z.enum(["fork", "mutation", "ensemble", "refinement"]);

export const SignalVariantSchema = z.object({
  variantId: z.string().uuid(),
  baseSignalId: z.string().uuid(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  variantType: SignalVariantType,
  rationale: z.string().optional(),
  deltaDescription: z.string().optional(), // Describes how this differs from the base
  confidenceShift: z.number().min(-1).max(1).optional(), // +/- change from base
  lineageDepth: z.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
});

export type SignalVariant = z.infer<typeof SignalVariantSchema>;

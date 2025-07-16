import { z } from "zod";

/* ---------- SCHEMA ---------- */
export const SignalFeedbackSchema = z.object({
  signalId: z.string(),
  feedbackType: z.enum(["positive", "negative", "neutral"]),
  reason: z.string().optional(),
  timestamp: z.string().datetime(),
  givenBy: z.string().optional(), // agent or user ID
});

/* ---------- RUNTIME TYPE ---------- */
export type SignalFeedback = z.infer<typeof SignalFeedbackSchema>;

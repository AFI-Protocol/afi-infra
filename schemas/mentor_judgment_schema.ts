// 🎓 AFI Mentor Judgment Schema

import { z } from "zod";

export const JudgmentTypeSchema = z.enum(["alignment", "accuracy", "adaptability", "trustworthiness", "bias_alert"]);

export const MentorJudgmentSchema = z.object({
  agentId: z.string(), // Unique ID of the scoring agent
  mentorId: z.string(), // Unique ID of the mentor
  judgmentType: JudgmentTypeSchema,
  signalId: z.string().optional(), // Optional if tied to a specific signal
  comments: z.string().optional(), // Human-readable or ML-translated summary
  score: z.number().min(0).max(100), // Scaled score from mentor
  timestamp: z.string().datetime(),
  metadata: z.record(z.any()).optional(), // Optional extra insight
});

export type MentorJudgment = z.infer<typeof MentorJudgmentSchema>;

import { z } from "zod";

/**
 * AOS Sync Loop Schema
 * Tracks agent synchronization checkpoints with the Agentic Operating System (AOS).
 */
export const AgentRoleEnum = z.enum(["validator", "mentor", "builder", "operator", "guardian"]);

export const AOSSyncLoopSchema = z.object({
  agentId: z.string(),
  timestamp: z.string().datetime(),
  role: AgentRoleEnum,
  syncStatus: z.enum(["synced", "error", "partial"]),
  memoryCheckpointHash: z.string().optional(),
  configVersion: z.string().optional(),
  feedback: z.array(z.string()).optional(),
  nextActions: z.array(z.string()).optional(),
});

export type AOSSyncLoop = z.infer<typeof AOSSyncLoopSchema>;

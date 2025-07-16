import { z } from "zod";

/**
 * Tracks the internal steps and decisions made by an agent during execution of a task.
 * Useful for post-mortems, fine-tuning, and auditability.
 */
export const ExecutionStepSchema = z.object({
  stepId: z.string(),
  timestamp: z.string().datetime(),
  description: z.string(),
  inputs: z.record(z.any()).optional(),
  outputs: z.record(z.any()).optional(),
  decision: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

export const AgentExecutionTraceSchema = z.object({
  agentId: z.string(),
  traceId: z.string().uuid(),
  taskType: z.string(),
  taskId: z.string().optional(),
  model: z.string().optional(),
  steps: z.array(ExecutionStepSchema),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  totalTokensUsed: z.number().optional(),
  notes: z.string().optional(),
});

export type AgentExecutionTrace = z.infer<typeof AgentExecutionTraceSchema>;
import { z } from "zod";

/**
 * Schema for a DAG-based pipeline configuration used by the AFI DAG Engine.
 */
export const dagPipelineConfigSchema = z.object({
  pipelineId: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(["task", "agent", "validator", "webhook"]),
      config: z.record(z.any()),
      dependsOn: z.array(z.string()).optional()
    })
  ),
  metadata: z.object({
    createdBy: z.string().optional(),
    createdAt: z.string().optional()
  }).optional()
});

export type DagPipelineConfig = z.infer<typeof dagPipelineConfigSchema>;

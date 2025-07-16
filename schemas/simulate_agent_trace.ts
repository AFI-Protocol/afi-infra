import { AgentExecutionTraceSchema } from "../schemas/agent_execution_trace_schema";

const dummyTrace = {
  agentId: "agent-42",
  traceId: "uuid-trace-1234",
  taskType: "signal_scoring",
  model: "gpt-4",
  startedAt: new Date().toISOString(),
  steps: [
    {
      stepId: "step-1",
      timestamp: new Date().toISOString(),
      description: "Analyze RSI level",
      inputs: { rsi: 73 },
      outputs: { overbought: true },
      decision: "Flag as overbought",
      confidenceScore: 0.92,
    },
  ],
  endedAt: new Date().toISOString(),
  totalTokensUsed: 856,
  notes: "Agent performed well under default scoring heuristics.",
};

const result = AgentExecutionTraceSchema.safeParse(dummyTrace);

if (!result.success) {
  console.error("Validation failed:", result.error.issues);
} else {
  console.log("Trace is valid:", result.data);
}
// 🧪 Agent Stub: Mentor Feedback Simulator

import { MentorJudgmentSchema } from "../schemas/mentor_judgment_schema";

const simulatedJudgment = MentorJudgmentSchema.parse({
  agentId: "agent-456",
  mentorId: "mentor-101",
  judgmentType: "alignment",
  comments: "Agent shows consistent misalignment when analyzing volatility-driven signals.",
  score: 68,
  timestamp: new Date().toISOString(),
});

console.log("Simulated Mentor Judgment:", simulatedJudgment);

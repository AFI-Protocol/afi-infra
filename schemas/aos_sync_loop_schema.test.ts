import { describe, it, expect } from "vitest";
import { AOSSyncLoopSchema } from "../schemas/aos_sync_loop_schema";

describe("AOSSyncLoopSchema", () => {
  it("validates a minimal sync object", () => {
    const result = AOSSyncLoopSchema.safeParse({
      agentId: "agent-123",
      timestamp: new Date().toISOString(),
      role: "validator",
      syncStatus: "synced"
    });
    expect(result.success).toBe(true);
  });
});

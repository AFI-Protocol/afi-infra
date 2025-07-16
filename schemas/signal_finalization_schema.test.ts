import { FinalizedSignalSchema } from "../schemas/signal_finalization_schema";

describe("FinalizedSignalSchema", () => {
  it("validates a correct finalized signal", () => {
    const result = FinalizedSignalSchema.safeParse({
      signalId: "123e4567-e89b-12d3-a456-426614174000",
      validatorId: "validator123",
      finalizedAt: new Date().toISOString(),
      validityScore: 87,
    });
    expect(result.success).toBe(true);
  });
});

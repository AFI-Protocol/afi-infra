import { z } from "zod";

// 🛰️ AFI Signal Transmission Schema

export const SignalTransmissionSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sender: z.string(), // Agent ID
  recipient: z.string().optional(), // Agent ID or null for broadcast
  channel: z.enum(["ably", "socketio", "internal"]),
  payload: z.record(z.any()),
  encrypted: z.boolean().default(false),
  signature: z.string().optional(),
});

// Inferred type
export type SignalTransmission = z.infer<typeof SignalTransmissionSchema>;
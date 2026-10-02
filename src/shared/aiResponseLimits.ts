export interface AiResponseLimits {
  responseBytes: number;
  errorBytes: number;
  outputCharacters: number;
  eventCharacters: number;
  events: number;
  idleTimeoutMs: number;
  durationMs: number;
  progressIntervalMs: number;
}

export const aiResponseLimits: Readonly<AiResponseLimits> = {
  responseBytes: 16 * 1024 * 1024,
  errorBytes: 64 * 1024,
  outputCharacters: 2_000_000,
  eventCharacters: 2_100_000,
  events: 100_000,
  idleTimeoutMs: 5 * 60_000,
  durationMs: 30 * 60_000,
  progressIntervalMs: 50
};

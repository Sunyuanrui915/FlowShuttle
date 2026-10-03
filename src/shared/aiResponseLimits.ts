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

const maxAiOutputCharacters = 2_000_000;

export const aiResponseLimits: Readonly<AiResponseLimits> = {
  responseBytes: 32 * 1024 * 1024,
  errorBytes: 64 * 1024,
  outputCharacters: maxAiOutputCharacters,
  // A JSON \uXXXX escape uses six raw characters per UTF-16 code unit.
  eventCharacters: maxAiOutputCharacters * 6 + 100_000,
  events: 200_000,
  idleTimeoutMs: 5 * 60_000,
  durationMs: 30 * 60_000,
  progressIntervalMs: 50
};

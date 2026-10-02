// Shared shapes for the worker's jobs.

export interface Job {
  id: number;
  kind: "transcribe_segment" | "finalize_transcript" | "generate_note" | "cleanup" | "delete_files";
  scribe_id: string | null;
  segment_id: string | null;
  note_id: string | null;
  payload: Record<string, unknown>;
  state: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface JobContext {
  workerId: string;
  // Milliseconds left before this run of the worker must stop.
  remaining(): number;
  saveState(state: Record<string, unknown>): Promise<void>;
}

// "finished": the job recorded its own result. "later": put it back in the queue.
export type Outcome =
  | { type: "finished" }
  | { type: "later"; delaySeconds: number; state: Record<string, unknown> };

export const FINISHED: Outcome = { type: "finished" };

export function later(delaySeconds: number, state: Record<string, unknown>): Outcome {
  return { type: "later", delaySeconds, state };
}

// A problem that is not an AI service error. `userMessage` is plain language.
export class JobError extends Error {
  constructor(
    message: string,
    public userMessage: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

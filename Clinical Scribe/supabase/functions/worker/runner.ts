// Claims queued jobs and runs up to three at once until this run's time is used up.
import { workerBudgetSeconds } from "../_shared/env.ts";
import { ProviderError, userMessage } from "../_shared/errors.ts";
import { sleep } from "../_shared/providers/request.ts";
import { scrub } from "../_shared/secrets.ts";
import { DatabaseError, rpc } from "../_shared/supabase.ts";
import { cleanup, deleteFiles } from "./jobs/files.ts";
import { generateNote } from "./jobs/note.ts";
import { transcribeSegment } from "./jobs/transcribe.ts";
import { FINISHED, type Job, type JobContext, JobError, type Outcome } from "./types.ts";

const CONCURRENCY = 3;
// New work is only started when at least this much time is left in the run.
const MIN_TIME_FOR_NEW_WORK_MS = 70_000;

// Jobs this process is working on, so they can be handed back if it is stopped.
const active = new Map<number, { worker: string; job: Job }>();

export async function releaseRunningJobs(): Promise<void> {
  const jobs = [...active.values()];
  active.clear();
  await Promise.allSettled(jobs.map(({ worker, job }) =>
    rpc("svc_job_reschedule", { p_id: job.id, p_worker: worker, p_delay_seconds: 0, p_state: job.state })
  ));
}

async function finalizeTranscript(job: Job, ctx: JobContext): Promise<Outcome> {
  await rpc("svc_finalize_transcript", { p_job_id: job.id, p_worker: ctx.workerId, p_scribe_id: job.scribe_id });
  return FINISHED;
}

const HANDLERS: Record<Job["kind"], (job: Job, ctx: JobContext) => Promise<Outcome>> = {
  transcribe_segment: transcribeSegment,
  finalize_transcript: finalizeTranscript,
  generate_note: generateNote,
  cleanup,
  delete_files: deleteFiles,
};

interface Failure {
  technical: string;
  message: string;
  retryable: boolean;
  delaySeconds: number | null;
}

export function describeFailure(error: unknown): Failure {
  if (error instanceof ProviderError) {
    return {
      technical: scrub(error.message),
      message: userMessage(error),
      retryable: error.retryable,
      delaySeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof JobError) {
    return { technical: scrub(error.message), message: error.userMessage, retryable: error.retryable, delaySeconds: null };
  }
  if (error instanceof DatabaseError && error.friendly) {
    return { technical: scrub(error.message), message: error.message, retryable: false, delaySeconds: null };
  }
  const text = error instanceof Error ? error.message : String(error);
  return {
    technical: scrub(text),
    message: "Something went wrong while processing. Please try again.",
    retryable: true,
    delaySeconds: null,
  };
}

async function runJob(job: Job, workerId: string, deadline: number): Promise<void> {
  const ctx: JobContext = {
    workerId,
    remaining: () => deadline - Date.now(),
    saveState: async (state) => {
      await rpc("svc_job_save_state", { p_id: job.id, p_worker: workerId, p_state: state });
      job.state = state;
    },
  };
  active.set(job.id, { worker: workerId, job });
  try {
    if (job.attempts >= job.max_attempts) {
      throw new JobError("The worker stopped during this job too many times.", "Processing took too long. Please try again.", false);
    }
    const outcome = await HANDLERS[job.kind](job, ctx);
    if (outcome.type === "later") {
      await rpc("svc_job_reschedule", {
        p_id: job.id,
        p_worker: workerId,
        p_delay_seconds: outcome.delaySeconds,
        p_state: outcome.state,
      });
    }
  } catch (error) {
    const failure = describeFailure(error);
    console.warn(`Job ${job.id} (${job.kind}) did not finish: ${failure.technical}`);
    try {
      await rpc("svc_job_failed", {
        p_job_id: job.id,
        p_worker: workerId,
        p_error: failure.technical,
        p_message: failure.message,
        p_retryable: failure.retryable,
        p_delay_seconds: failure.delaySeconds,
      });
    } catch (recordError) {
      // The lease will run out and the job will be tried again.
      console.error(`Could not record the failure of job ${job.id}: ${scrub(String(recordError))}`);
    }
  } finally {
    active.delete(job.id);
  }
}

export async function runWorker(): Promise<void> {
  const workerId = crypto.randomUUID();
  const budgetMs = workerBudgetSeconds() * 1000;
  // The platform may reuse one function process for several wake-up calls and stop
  // it while a job is running. Unfinished jobs are handed back when that happens
  // (see releaseRunningJobs), and long work keeps its progress in the job's state.
  const deadline = Date.now() + budgetMs;
  // New work is only started while there is time to finish it in this run.
  const claimUntil = deadline - MIN_TIME_FOR_NEW_WORK_MS;
  const leaseSeconds = Math.ceil(budgetMs / 1000) + 90;
  const running = new Set<Promise<void>>();

  while (Date.now() < claimUntil) {
    const free = CONCURRENCY - running.size;
    if (free > 0) {
      let jobs: Job[] = [];
      try {
        jobs = (await rpc<Job[]>("svc_claim_jobs", {
          p_worker: workerId,
          p_limit: free,
          p_lease_seconds: leaseSeconds,
        })) ?? [];
      } catch (error) {
        console.error(`Could not claim jobs: ${scrub(String(error))}`);
        break;
      }
      for (const job of jobs) {
        const task: Promise<void> = runJob(job, workerId, deadline).finally(() => running.delete(task));
        running.add(task);
      }
      if (jobs.length > 0) continue;
      if (running.size === 0) break;
    }
    // Wait for a free slot, or look again shortly for work queued by finished jobs.
    await Promise.race([...running, sleep(2000)]);
  }
  await Promise.allSettled([...running]);
}

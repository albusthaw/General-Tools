// Removing audio: after a recording or account is deleted, and on the hourly clean-up.
import { rpc } from "../../_shared/supabase.ts";
import { listFiles, removeFiles } from "../storage.ts";
import { FINISHED, type Job, type JobContext, JobError, type Outcome } from "../types.ts";

export async function deleteFiles(job: Job, ctx: JobContext): Promise<Outcome> {
  const prefix = typeof job.payload.prefix === "string" ? job.payload.prefix : "";
  if (!prefix) throw new JobError("No folder given.", "Files could not be removed.", false);
  await removeFiles(await listFiles(prefix));
  if (typeof job.payload.scribe_id === "string") {
    await rpc("svc_mark_audio_deleted", { p_scribe_id: job.payload.scribe_id });
  }
  await rpc("svc_job_done", { p_id: job.id, p_worker: ctx.workerId });
  return FINISHED;
}

interface Target {
  scribe_id: string;
  owner_id: string;
  action: "delete_audio" | "remove_abandoned";
}

export async function cleanup(job: Job, ctx: JobContext): Promise<Outcome> {
  const targets = await rpc<Target[]>("svc_cleanup_targets");
  for (const target of targets ?? []) {
    if (ctx.remaining() < 20_000) break;
    await removeFiles(await listFiles(`${target.owner_id}/${target.scribe_id}`));
    if (target.action === "remove_abandoned") {
      await rpc("svc_remove_abandoned", { p_scribe_id: target.scribe_id });
    } else {
      await rpc("svc_mark_audio_deleted", { p_scribe_id: target.scribe_id });
    }
  }
  await rpc("svc_expire_reviews");
  await rpc("svc_prune_jobs");
  await rpc("svc_job_done", { p_id: job.id, p_worker: ctx.workerId });
  return FINISHED;
}

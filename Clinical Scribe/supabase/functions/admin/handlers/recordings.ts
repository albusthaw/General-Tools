// Recording audio for admins. Opening a recording needs a reason and writes an
// audit entry (in the database function); the audio is then passed through here,
// part by part, so it never has an address anyone else could use.
import { AppError, FileReply } from "../../_shared/http.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export async function unlock({ caller, body }: AdminContext) {
  const scribeId = v.uuid(body.scribe_id, "Recording");
  const reason = v.text(body.reason, { label: "Reason", min: 10, max: 500 });
  if (!v.bool(body.confirmed)) {
    throw new AppError("not_confirmed", "Tick the box to confirm you understand that opening the audio is recorded.", 400);
  }
  return await rpc("svc_recording_unlock", {
    p_admin: caller.id,
    p_scribe_id: scribeId,
    p_reason: reason,
    p_user_agent: caller.userAgent,
  });
}

export async function part({ caller, body }: AdminContext) {
  const scribeId = v.uuid(body.scribe_id, "Recording");
  const seq = v.number(body.seq, { label: "Part", min: 1, max: 999, integer: true });
  const download = v.bool(body.download);
  const info = await rpc<{ storage_path: string; mime_type: string; recorded_at: string }>("svc_recording_part", {
    p_admin: caller.id,
    p_scribe_id: scribeId,
    p_seq: seq,
    p_download: download,
    p_user_agent: caller.userAgent,
  });
  const { data, error } = await adminClient().storage.from("recordings").download(info.storage_path);
  if (error || !data) throw new AppError("audio_missing", "This part of the audio could not be found.", 404);
  const day = String(info.recorded_at ?? "").slice(0, 10) || "recording";
  return new FileReply(data, `clinical-scribe-${day}-part-${seq}.${EXTENSIONS[info.mime_type] ?? "audio"}`);
}

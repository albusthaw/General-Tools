// Audio files in the private "recordings" bucket.
import { adminClient } from "../_shared/supabase.ts";
import { JobError } from "./types.ts";

const BUCKET = "recordings";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PREFIX = new RegExp(`^${UUID}(/${UUID})?$`);

export async function downloadAudio(path: string): Promise<Blob> {
  const { data, error } = await adminClient().storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new JobError(`Could not download ${path}: ${error?.message ?? "no data"}`, "The audio could not be read. Please try again.", true);
  }
  return data;
}

// Every file under "<user>" or "<user>/<recording>".
export async function listFiles(prefix: string): Promise<string[]> {
  if (!PREFIX.test(prefix)) throw new JobError(`Refusing to list "${prefix}".`, "Files could not be removed.", false);
  const bucket = adminClient().storage.from(BUCKET);
  const files: string[] = [];
  const folders = [prefix];
  while (folders.length > 0 && files.length < 10_000) {
    const folder = folders.shift() as string;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(folder, { limit: 1000, offset });
      if (error) throw new JobError(`Could not list ${folder}: ${error.message}`, "Files could not be removed.", true);
      for (const item of data ?? []) {
        const path = `${folder}/${item.name}`;
        if (item.id === null) folders.push(path);
        else files.push(path);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return files;
}

export async function removeFiles(paths: string[]): Promise<void> {
  const bucket = adminClient().storage.from(BUCKET);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100));
    if (error) throw new JobError(`Could not remove files: ${error.message}`, "Files could not be removed.", true);
  }
}

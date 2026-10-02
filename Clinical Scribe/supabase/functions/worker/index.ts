// The worker is woken by the database (never by browsers). It checks the shared
// secret, answers at once, and keeps working in the background.
import { scrub } from "../_shared/secrets.ts";
import { releaseRunningJobs, runWorker } from "./runner.ts";
import { isWorkerSecret } from "./secret.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// When the platform is about to stop this function, hand unfinished jobs back to
// the queue so the next run can pick them up straight away.
addEventListener("beforeunload", () => {
  releaseRunningJobs().catch(() => {});
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(404, { error: "Not found." });
  let allowed = false;
  try {
    allowed = await isWorkerSecret(req.headers.get("x-worker-secret") ?? "");
  } catch (error) {
    console.error(`Worker could not read its secret: ${scrub(String(error))}`);
    return reply(503, { error: "Not ready." });
  }
  if (!allowed) return reply(401, { error: "Not allowed." });
  await req.body?.cancel();

  const work = runWorker().catch((error) => console.error(`Worker stopped: ${scrub(String(error))}`));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return reply(202, { accepted: true });
});

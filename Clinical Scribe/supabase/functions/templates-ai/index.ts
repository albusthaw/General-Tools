// Template helper: turns a clinician's description into a detailed note template.
import { requireUser } from "../_shared/auth.ts";
import { readJson, serve } from "../_shared/http.ts";
import { oneOf, text } from "../_shared/validate.ts";
import { draftTemplate } from "./draft.ts";

serve(async (req) => {
  const caller = await requireUser(req);
  const body = await readJson(req);
  const action = oneOf(body.action, ["draft", "revise"] as const, "action");
  // Older apps send no Template Type: their templates are Clinical Scribe ones.
  const type = body.type === undefined ? "scribe" : oneOf(body.type, ["scribe", "voice"] as const, "Template Type");

  if (action === "draft") {
    const description = text(body.description, { label: "A description of the note", min: 10, max: 4000, multiline: true });
    return await draftTemplate(caller, type, { mode: "draft", description });
  }

  const current = (body.current ?? {}) as Record<string, unknown>;
  return await draftTemplate(caller, type, {
    mode: "revise",
    current: {
      name: text(current.name, { label: "Template name", min: 1, max: 80 }),
      description: text(current.description, { label: "Description", max: 300 }),
      body: text(current.body, { label: "Template text", min: 10, max: 12000, multiline: true }),
    },
    changes: text(body.changes, { label: "The changes you want", min: 3, max: 2000, multiline: true }),
  });
});

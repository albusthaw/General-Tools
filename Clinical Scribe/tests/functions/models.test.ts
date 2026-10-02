// Unit tests for the model lists in AI settings and for reading Gemini's answer
// states. Run from the Clinical Scribe folder: deno test tests/functions/
import { assertEquals } from "jsr:@std/assert@1";
import { mergeChoices } from "../../supabase/functions/_shared/models.ts";
import { choicesFor, interactionState, suitsPurpose } from "../../supabase/functions/_shared/providers/gemini.ts";

const offered = (...ids: string[]) => ids.map((id) => ({ id, label: id }));

Deno.test("known good models come first, then the newest of the others", () => {
  const known = [{ id: "model-b", label: "Model B", recommended: true }];
  const list = mergeChoices(known, offered("model-a-2", "model-b", "model-a-10"));
  assertEquals(list.map((m) => m.id), ["model-b", "model-a-10", "model-a-2"]);
  assertEquals(list[0], { id: "model-b", label: "Model B", recommended: true, available: true });
  assertEquals(list[1].available, true);
});

Deno.test("a known model the service does not offer is marked, and nothing is marked without a list", () => {
  const known = [{ id: "model-b", label: "Model B" }];
  assertEquals(mergeChoices(known, offered("model-c"))[0].available, false);
  assertEquals("available" in mergeChoices(known, [])[0], false);
});

Deno.test("only file transcription models are offered for transcription", () => {
  assertEquals(suitsPurpose("gemini-3.5-transcribe", "transcription"), true);
  assertEquals(suitsPurpose("gemini-3.5-transcribe-live", "transcription"), false);
  assertEquals(suitsPurpose("gemini-3.8-flash", "transcription"), false);
  assertEquals(suitsPurpose("whisper-1", "transcription"), false);
});

Deno.test("writing models leave out speech, image, live and transcription models", () => {
  assertEquals(suitsPurpose("gemini-3.8-flash", "text"), true);
  assertEquals(suitsPurpose("gemini-3.7-pro", "text"), true);
  for (const id of ["gemini-3.5-transcribe", "gemini-3.8-flash-live", "gemini-3.8-flash-tts", "gemini-embedding-002", "gemini-3.8-flash-image"]) {
    assertEquals(suitsPurpose(id, "text"), false, id);
  }
});

Deno.test("the general Gemini model stays a transcription choice when the account has it", () => {
  const list = choicesFor("transcription", offered("gemini-3.8-flash", "gemini-3.5-transcribe", "gemini-3.5-transcribe-live", "gemini-3.6-transcribe"));
  assertEquals(list.map((m) => [m.id, m.available]), [
    ["gemini-3.5-transcribe", true],
    ["gemini-3.8-flash", true],
    ["gemini-3.6-transcribe", true],
  ]);
});

Deno.test("Gemini answers that stop early are used only when they have text", () => {
  const withText = { outputs: [{ type: "text", text: "Subjective: cough" }] };
  assertEquals(interactionState({ status: "completed", ...withText }), "done");
  assertEquals(interactionState({ status: "incomplete", ...withText }), "done");
  assertEquals(interactionState({ status: "budget_exceeded", outputs: [] }), "failed");
  assertEquals(interactionState({ status: "requires_action" }), "failed");
  assertEquals(interactionState({ status: "queued" }), "running");
  assertEquals(interactionState({ status: "in_progress" }), "running");
});

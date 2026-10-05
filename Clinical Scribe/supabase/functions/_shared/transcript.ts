// Turns word-level speaker labels into readable "Speaker 1: ..." lines, or, for a
// Voice Note, into plain text.

export interface LabelledWord {
  text: string;
  type?: string;
  speaker: string | null;
}

// Adds one word (or a spacing entry) to the text being built.
function appendWord(buffer: string, word: LabelledWord): string {
  if (word.type === "spacing") return buffer + (word.text || " ");
  // Words without explicit spacing entries (some services) need a space between them.
  const needsSpace = buffer.length > 0 && !/\s$/.test(buffer) && !/^[.,!?;:%)\]]/.test(word.text);
  return buffer + (needsSpace ? " " : "") + word.text;
}

// Speakers are numbered in the order they first speak.
export function buildSpeakerTranscript(words: LabelledWord[], fallback: string): string {
  const spoken = words.filter((word) => word.type !== "audio_event");
  if (!spoken.some((word) => word.speaker)) return tidy(fallback);

  const numbers = new Map<string, number>();
  const lines: string[] = [];
  let current: string | null = null;
  let buffer = "";

  const flush = () => {
    const textValue = tidy(buffer);
    if (textValue) {
      const label = current === null ? "Speaker" : `Speaker ${numbers.get(current)}`;
      lines.push(`${label}: ${textValue}`);
    }
    buffer = "";
  };

  for (const word of spoken) {
    if (word.type !== "spacing" && word.speaker && word.speaker !== current) {
      flush();
      current = word.speaker;
      if (!numbers.has(current)) numbers.set(current, numbers.size + 1);
    }
    buffer = appendWord(buffer, word);
  }
  flush();
  return lines.join("\n");
}

// A Voice Note has one speaker, so its transcript never carries speaker labels,
// even when a service marks the words with speakers anyway.
export function buildPlainTranscript(words: LabelledWord[], fallback: string): string {
  const text = tidy(fallback);
  if (text) return text;
  let buffer = "";
  for (const word of words) {
    if (word.type !== "audio_event") buffer = appendWord(buffer, word);
  }
  return tidy(buffer);
}

function tidy(text: string): string {
  return String(text ?? "").replace(/[ \t]+/g, " ").replace(/ +([.,!?;:])/g, "$1").trim();
}

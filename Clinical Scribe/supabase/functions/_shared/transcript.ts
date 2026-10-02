// Turns word-level speaker labels into readable "Speaker 1: ..." lines.

export interface LabelledWord {
  text: string;
  type?: string;
  speaker: string | null;
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
    const isSpacing = word.type === "spacing";
    if (!isSpacing && word.speaker && word.speaker !== current) {
      flush();
      current = word.speaker;
      if (!numbers.has(current)) numbers.set(current, numbers.size + 1);
    }
    if (isSpacing) {
      buffer += word.text || " ";
    } else {
      // Words without explicit spacing entries (some services) need a space between them.
      const needsSpace = buffer.length > 0 && !/\s$/.test(buffer) && !/^[.,!?;:%)\]]/.test(word.text);
      buffer += (needsSpace ? " " : "") + word.text;
    }
  }
  flush();
  return lines.join("\n");
}

function tidy(text: string): string {
  return String(text ?? "").replace(/[ \t]+/g, " ").replace(/ +([.,!?;:])/g, "$1").trim();
}

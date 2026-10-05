// The two ways to record. Clinical Scribe is a conversation between two or more
// people; a Voice Note is one person dictating. Templates carry the same type
// (the Template Type). The server calls the type "mode": "scribe" or "voice".

export const MODES = {
  scribe: {
    id: "scribe",
    name: "Clinical Scribe",
    line: "Two or more people talking, like a consultation",
    icon: "conversation",
    path: "/scribe",
    historyPath: "/history",
    route: "scribe",
    historyRoute: "history",
    newTitle: "New recording",
    label: "Recording",
    noun: "recording",
    nouns: "recordings",
    untitled: "Recording at",
    startLabel: "Start recording",
    hint: "Put the phone or computer where everyone can be heard.",
    busyTitle: "A Clinical Scribe recording is going on",
    emptyTitle: "No recordings yet",
    emptyText: "Your recordings, transcripts and notes will appear here.",
    emptyAction: "Start a recording",
    example:
      "For example: a medical clerking note with presenting complaint, history of presenting complaint, past medical history, drug history and allergies, social and family history, systems review, examination, impression and plan.",
  },
  voice: {
    id: "voice",
    name: "Voice Note",
    line: "Just you, dictating a note or a letter",
    icon: "voice",
    path: "/voice",
    historyPath: "/history/voice",
    route: "voice",
    historyRoute: "history-voice",
    newTitle: "New voice note",
    label: "Voice note",
    noun: "voice note",
    nouns: "voice notes",
    untitled: "Voice note at",
    startLabel: "Start voice note",
    hint: "Speak as you would to a colleague. Say “full stop” or “new paragraph” whenever you like.",
    busyTitle: "A Voice Note is being recorded",
    emptyTitle: "No voice notes yet",
    emptyText: "Your voice notes, transcripts and notes will appear here.",
    emptyAction: "Record a voice note",
    example:
      "For example: a clinic letter to the family doctor with the reason for the visit, what was found, changes to medicines and the follow-up plan.",
  },
};

export const MODE_LIST = [MODES.scribe, MODES.voice];

/** The type for a stored value; anything unknown (older records) is Clinical Scribe. */
export function modeOf(value) {
  return value === "voice" ? MODES.voice : MODES.scribe;
}

/** "1 voice note" or "3 recordings". */
export function countOf(mode, count) {
  const type = modeOf(mode);
  return `${count} ${count === 1 ? type.noun : type.nouns}`;
}

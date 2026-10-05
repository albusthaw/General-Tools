// The templates of one type (Template Type): Clinical Scribe or Voice Note.
// Templates made before Voice Note existed are Clinical Scribe templates.
export function templatesOfMode(templates, mode) {
  return templates.filter((t) => (t.mode === "voice" ? "voice" : "scribe") === mode);
}

// Template choices for select fields: shared templates first (default on top),
// then the person's own.
export function templateOptions(templates) {
  const shared = templates.filter((t) => t.scope === "shared");
  const mine = templates.filter((t) => t.scope === "personal");
  const groups = [];
  if (shared.length) {
    groups.push({
      group: "Shared templates",
      options: shared.map((t) => ({ value: t.id, label: t.is_default ? `${t.name} (default)` : t.name })),
    });
  }
  if (mine.length) {
    groups.push({ group: "Your templates", options: mine.map((t) => ({ value: t.id, label: t.name })) });
  }
  return groups;
}

export function defaultTemplateId(templates, preferred = null) {
  if (preferred && templates.some((t) => t.id === preferred)) return preferred;
  return templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "";
}

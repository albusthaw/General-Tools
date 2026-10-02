// Model choices shown in AI settings.

export interface ModelChoice {
  id: string;
  label: string;
  note?: string;
  recommended?: boolean;
  // False when the service's own list does not offer the model to this key.
  available?: boolean;
}

/**
 * Known good models first (marked), then the others the service offers, newest
 * first. When the service's full list is known, known models it does not offer
 * are marked as not available.
 */
export function mergeChoices(known: ModelChoice[], offered: ModelChoice[], everything?: ModelChoice[]): ModelChoice[] {
  const all = new Set((everything ?? offered).map((m) => m.id));
  const seen = new Set<string>();
  const result: ModelChoice[] = [];
  for (const model of known) {
    seen.add(model.id);
    result.push(everything || offered.length > 0 ? { ...model, available: all.has(model.id) } : { ...model });
  }
  const others = offered
    .filter((m) => !seen.has(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  for (const model of others) {
    seen.add(model.id);
    result.push({ id: model.id, label: model.label, available: true });
  }
  return result;
}

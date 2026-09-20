/** Returns the manual order with incomplete items first and completed items last. */
export function completionDisplayOrder(
  baseOrder: readonly string[],
  completedIds: ReadonlySet<string>,
): string[] {
  const open: string[] = [];
  const done: string[] = [];
  for (const id of baseOrder) (completedIds.has(id) ? done : open).push(id);
  return [...open, ...done];
}

/** Replaces only the slots occupied by a visible/filterable subset. */
export function mergeSubsetOrder(
  globalOrder: readonly string[],
  requestedSubsetOrder: readonly string[],
): string[] {
  const globalIds = new Set(globalOrder);
  const seen = new Set<string>();
  const requested = requestedSubsetOrder.filter((id) => {
    if (!globalIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const subsetIds = new Set(requested);
  const remaining = globalOrder.filter((id) => subsetIds.has(id) && !seen.delete(id));
  const replacements = [...requested, ...remaining];
  const slots = new Set(replacements);
  let index = 0;
  return globalOrder.map((id) => (slots.has(id) ? replacements[index++] : id));
}

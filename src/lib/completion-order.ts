export interface CompletionItem {
  id: string;
  completed: boolean;
}

export function initialCompletionOrder(items: readonly CompletionItem[]): string[] {
  const open: string[] = [];
  const done: string[] = [];
  for (const item of items) (item.completed ? done : open).push(item.id);
  return [...open, ...done];
}

export function reconcileCompletionOrder(
  order: readonly string[],
  items: readonly CompletionItem[],
): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const next = order.filter((id) => {
    if (!byId.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.completed) {
      next.push(item.id);
      continue;
    }
    const firstCompleted = next.findIndex((id) => byId.get(id)?.completed);
    if (firstCompleted === -1) next.push(item.id);
    else next.splice(firstCompleted, 0, item.id);
  }
  return next;
}

export function moveCompletionItem(
  order: readonly string[],
  id: string,
  completed: boolean,
  items: readonly CompletionItem[],
): string[] {
  if (!items.some((item) => item.id === id)) return reconcileCompletionOrder(order, items);

  const byId = new Map(items.map((item) => [item.id, item]));
  const next = reconcileCompletionOrder(order, items).filter((candidate) => candidate !== id);
  if (completed) return [...next, id];

  const firstCompleted = next.findIndex((candidate) => byId.get(candidate)?.completed);
  if (firstCompleted === -1) return [...next, id];
  return [...next.slice(0, firstCompleted), id, ...next.slice(firstCompleted)];
}

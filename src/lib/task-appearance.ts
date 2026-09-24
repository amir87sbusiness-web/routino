import { CATEGORY_COLOR_CHOICES } from "./presets";
import type { Category, Task } from "./store";

const TASK_DEFAULT_COLOR = CATEGORY_COLOR_CHOICES[0];
const TASK_DEFAULT_ICON = "star";

export function uncategorizedTaskColor(taskId: string): string {
  let hash = 0;
  for (const char of taskId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CATEGORY_COLOR_CHOICES[hash % CATEGORY_COLOR_CHOICES.length];
}

export function resolveTaskAppearance(
  task: Pick<Task, "categoryId" | "color" | "icon">,
  categories: readonly Category[],
): { color: string; icon: string } {
  const category = task.categoryId
    ? categories.find((candidate) => candidate.id === task.categoryId)
    : undefined;
  return category
    ? { color: category.color, icon: category.icon }
    : { color: task.color ?? TASK_DEFAULT_COLOR, icon: TASK_DEFAULT_ICON };
}

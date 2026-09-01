import {
  expandTaskMonthArchive,
  type StoredTaskMonthRecord,
} from "../../backend/src/services/task-month-archive.js";
import type { Task } from "../../src/lib/store";

/** Test-only fixture: released clients continue to receive ordinary tasks. */
export function oneYearTaskFixture(): Task[] {
  return Array.from({ length: 365 * 10 }, (_, index) => ({
    id: `task-${index}`,
    dateKey: new Date(Date.UTC(2025, 0, Math.floor(index / 10) + 1)).toISOString().slice(0, 10),
    title: index % 2 === 0 ? `مطالعه ${index}` : `کار ${index}`,
    type: "binary",
    target: 1,
    value: 1,
    done: true,
  }));
}

/** Derives client-visible tasks through the real server archive expansion codec. */
export function archiveExpandedOneYearTasks(): Task[] {
  const byMonth = new Map<string, Array<{ task: Task; updatedAt: number }>>();
  for (const [index, task] of oneYearTaskFixture().entries()) {
    const month = task.dateKey.slice(0, 7);
    const updatedAt = Date.parse(`${task.dateKey}T12:00:00.000Z`) + (index % 10);
    byMonth.set(month, [...(byMonth.get(month) ?? []), { task, updatedAt }]);
  }

  const expanded: Task[] = [];
  let seq = 1;
  for (const [month, monthTasks] of byMonth) {
    for (let offset = 0; offset < monthTasks.length; offset += 32) {
      const chunk = monthTasks.slice(offset, offset + 32);
      const record: StoredTaskMonthRecord = {
        kind: "taskMonths",
        id: `${month}|compat-${offset / 32}`,
        data: {
          v: 1,
          monthKey: month,
          count: chunk.length,
          checksum: "a".repeat(32),
          items: chunk.map(({ task, updatedAt }) => [task.id, updatedAt, task]),
        },
        updatedAt: Math.max(...chunk.map((item) => item.updatedAt)),
        deleted: false,
        seq,
      };
      expanded.push(...expandTaskMonthArchive(record).map((item) => item.data as Task));
      seq += 1;
    }
  }
  return expanded;
}

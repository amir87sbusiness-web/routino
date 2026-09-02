import {
  expandTaskMonthArchive,
  type StoredTaskMonthRecord,
} from "../../backend/src/services/task-month-archive.js";
import { createHash } from "node:crypto";
import type { Task } from "../../src/lib/store";

const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const postgresJsonbText = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${postgresJsonbText(item)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
};

/** Test-only fixture: released clients continue to receive ordinary tasks. */
export function oneYearTaskFixture(): Task[] {
  return Array.from({ length: 365 * 10 }, (_, index) => ({
    // Fixed-width ids keep this synthetic source order equal to the immutable
    // archive convention, which orders items lexically by id.
    id: `task-${String(index).padStart(5, "0")}`,
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
      const items = chunk.map(
        ({ task, updatedAt }) => [task.id, updatedAt, task] as [string, number, Task],
      );
      const record: StoredTaskMonthRecord = {
        kind: "taskMonths",
        id: `${month}|${md5(items.map(([id]) => id).join("\n"))}`,
        data: {
          v: 1,
          monthKey: month,
          count: chunk.length,
          checksum: md5(
            items
              .map(([id, updatedAt, task]) => `${id}\n${updatedAt}\n${postgresJsonbText(task)}`)
              .join("\n"),
          ),
          items,
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

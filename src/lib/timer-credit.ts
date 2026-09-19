import { applyLog } from "../components/habits";
import { dateKey } from "./dates";
import type { Calendar } from "./dates";
import { getLog } from "./logic";
import type { Db } from "./store";
import type { TimerCompletion } from "./timer-runtime";

export function recordTimerCompletion(db: Db, item: TimerCompletion, cal: Calendar): Db {
  if (db.timerSessions.some((session) => session.id === item.id)) return db;
  const link = item.linked;
  const minutes = item.focusSeconds / 60;
  const dk = dateKey(new Date(item.endedAt));
  let next = db;
  if (link?.kind === "task") {
    next = {
      ...next,
      tasks: next.tasks.map((task) => {
        if (task.id !== link.id) return task;
        const value =
          task.type === "binary"
            ? task.target
            : task.unitKind === "time"
              ? Math.round((task.value + minutes) * 100) / 100
              : task.value + Math.round(minutes);
        return { ...task, value, done: task.done || value >= task.target };
      }),
    };
  } else if (link?.kind === "habit") {
    const habit = next.habits.find((candidate) => candidate.id === link.id);
    if (habit) {
      const previous = getLog(next, habit.id, dk)?.value ?? 0;
      const value =
        habit.type === "binary"
          ? 1
          : habit.unitKind === "time"
            ? Math.round((previous + minutes) * 100) / 100
            : previous + Math.round(minutes);
      next = applyLog(next, habit, cal, { value, done: value >= habit.target }, dk).db;
    }
  }
  return {
    ...next,
    timerSessions: [
      {
        id: item.id,
        mode: item.mode,
        focusSeconds: item.focusSeconds,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        linkedKind: link?.kind,
        linkedId: link?.id,
        linkedLabel: link?.label,
      },
      ...next.timerSessions,
    ]
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 200),
  };
}

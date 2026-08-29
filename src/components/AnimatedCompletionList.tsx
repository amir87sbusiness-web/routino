import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  initialCompletionOrder,
  moveCompletionItem,
  reconcileCompletionOrder,
  type CompletionItem,
} from "@/lib/completion-order";

const REORDER_DELAY_MS = 450;
const REORDER_MOTION_MS = 260;
const REORDER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface AnimatedCompletionListProps<T extends { id: string }> {
  items: readonly T[];
  isCompleted: (item: T) => boolean;
  className?: string;
  renderItem: (item: T, onCompletionChange: (completed: boolean) => void) => ReactNode;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function AnimatedCompletionList<T extends { id: string }>({
  items,
  isCompleted,
  className,
  renderItem,
}: AnimatedCompletionListProps<T>) {
  const snapshot = useMemo<CompletionItem[]>(
    () => items.map((item) => ({ id: item.id, completed: isCompleted(item) })),
    [items, isCompleted],
  );
  const sourceRef = useRef(snapshot);
  sourceRef.current = snapshot;
  const [order, setOrder] = useState(() => initialCompletionOrder(snapshot));
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const animationsRef = useRef<Animation[]>([]);
  const sourceIds = items.map((item) => item.id).join("\u0000");

  const effectiveOrder = reconcileCompletionOrder(order, snapshot);
  const byId = new Map(items.map((item) => [item.id, item]));

  const captureRects = () => {
    const rects = new Map<string, DOMRect>();
    const children = containerRef.current?.children ?? [];
    for (const child of children) {
      const element = child as HTMLElement;
      const id = element.dataset.completionId;
      if (id) rects.set(id, element.getBoundingClientRect());
    }
    return rects;
  };

  const finishAnimations = () => {
    for (const animation of animationsRef.current) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
    animationsRef.current = [];
  };

  useEffect(() => {
    setOrder((current) => {
      const next = reconcileCompletionOrder(current, sourceRef.current);
      return sameOrder(current, next) ? current : next;
    });
    const liveIds = new Set(sourceRef.current.map((item) => item.id));
    for (const [id, timer] of timersRef.current) {
      if (liveIds.has(id)) continue;
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, [sourceIds]);

  useLayoutEffect(() => {
    const before = beforeRectsRef.current;
    beforeRectsRef.current = null;
    if (!before || prefersReducedMotion()) return;

    const animations: Animation[] = [];
    const children = containerRef.current?.children ?? [];
    for (const child of children) {
      const element = child as HTMLElement;
      const id = element.dataset.completionId;
      const previous = id ? before.get(id) : undefined;
      if (!previous || typeof element.animate !== "function") continue;
      const current = element.getBoundingClientRect();
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaY) < 0.5) continue;
      animations.push(
        element.animate(
          [
            { transform: `translate3d(0, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          { duration: REORDER_MOTION_MS, easing: REORDER_EASING },
        ),
      );
    }
    animationsRef.current = animations;
  }, [order]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      for (const animation of animationsRef.current) animation.cancel();
      animationsRef.current = [];
    },
    [],
  );

  const scheduleMove = (id: string, completed: boolean) => {
    const previousTimer = timersRef.current.get(id);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      finishAnimations();
      beforeRectsRef.current = captureRects();
      setOrder((current) => {
        const next = moveCompletionItem(current, id, completed, sourceRef.current);
        if (sameOrder(current, next)) {
          beforeRectsRef.current = null;
          return current;
        }
        return next;
      });
    }, REORDER_DELAY_MS);
    timersRef.current.set(id, timer);
  };

  return (
    <div ref={containerRef} className={className}>
      {effectiveOrder.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <div key={id} data-completion-id={id} className="completion-list-item">
            {renderItem(item, (completed) => scheduleMove(id, completed))}
          </div>
        );
      })}
    </div>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { completionDisplayOrder, mergeSubsetOrder } from "@/lib/local-order";

const REORDER_DELAY_MS = 450;
const LONG_PRESS_MS = 350;
const PRESS_CANCEL_DISTANCE = 8;
const REORDER_MOTION_MS = 260;
const REORDER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface AnimatedCompletionListProps<T extends { id: string }> {
  items: readonly T[];
  isCompleted: (item: T) => boolean;
  className?: string;
  onReorder?: (orderedIds: string[]) => void;
  onReorderStart?: () => void;
  renderItem: (item: T, onCompletionChange: (completed: boolean) => void) => ReactNode;
}

interface PressDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  target: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  preview: string[];
  touchMoveListener?: EventListener;
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
  onReorder,
  onReorderStart,
  renderItem,
}: AnimatedCompletionListProps<T>) {
  const snapshot = useMemo(
    () => items.map((item) => ({ id: item.id, completed: isCompleted(item) })),
    [items, isCompleted],
  );
  const [displayCompleted, setDisplayCompleted] = useState(
    () => new Map(snapshot.map((item) => [item.id, item.completed])),
  );
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const animationsRef = useRef<Animation[]>([]);
  const dragRef = useRef<PressDrag | null>(null);
  const suppressClickUntil = useRef(0);
  const sourceIds = items.map((item) => item.id).join("\u0000");
  const completionSignature = snapshot
    .map((item) => `${item.id}:${Number(item.completed)}`)
    .join("\u0000");
  const baseOrder = items.map((item) => item.id);
  const completedIds = new Set(
    baseOrder.filter(
      (id) =>
        displayCompleted.get(id) ?? snapshot.find((item) => item.id === id)?.completed ?? false,
    ),
  );
  const groupedOrder = completionDisplayOrder(baseOrder, completedIds);
  const effectiveOrder = previewOrder ?? groupedOrder;
  const effectiveOrderSignature = effectiveOrder.join("\u0000");
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
    const liveIds = new Set(snapshot.map((item) => item.id));
    setDisplayCompleted((current) => {
      const next = new Map(current);
      for (const id of next.keys()) if (!liveIds.has(id)) next.delete(id);
      for (const item of snapshot) {
        if (!next.has(item.id) || !timersRef.current.has(item.id)) {
          next.set(item.id, item.completed);
        }
      }
      return next;
    });
    for (const [id, timer] of timersRef.current) {
      if (liveIds.has(id)) continue;
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, [sourceIds, completionSignature, snapshot]);

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
          [{ transform: `translate3d(0, ${deltaY}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
          { duration: REORDER_MOTION_MS, easing: REORDER_EASING },
        ),
      );
    }
    animationsRef.current = animations;
  }, [effectiveOrderSignature]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      const drag = dragRef.current;
      if (drag?.timer) clearTimeout(drag.timer);
      if (drag?.touchMoveListener)
        drag.target.removeEventListener("touchmove", drag.touchMoveListener);
      if (drag?.target.hasPointerCapture?.(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
      for (const animation of animationsRef.current) animation.cancel();
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
      setDisplayCompleted((current) => new Map(current).set(id, completed));
    }, REORDER_DELAY_MS);
    timersRef.current.set(id, timer);
  };

  const finishDrag = (pointerId: number, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.touchMoveListener)
      drag.target.removeEventListener("touchmove", drag.touchMoveListener);
    if (drag.target.hasPointerCapture?.(pointerId)) drag.target.releasePointerCapture(pointerId);
    if (drag.active) {
      suppressClickUntil.current = Date.now() + 300;
      if (!cancelled && !sameOrder(groupedOrder, drag.preview)) {
        const draggedCompleted = completedIds.has(drag.id);
        const reorderedGroup = drag.preview.filter(
          (id) => completedIds.has(id) === draggedCompleted,
        );
        onReorder?.(mergeSubsetOrder(baseOrder, reorderedGroup));
      }
    }
    dragRef.current = null;
    setPreviewOrder(null);
    setDraggingId(null);
  };

  const bindingsFor = (id: string) => {
    const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
      if (!onReorder || dragRef.current || (event.pointerType === "mouse" && event.button !== 0))
        return;
      const drag: PressDrag = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        target: event.currentTarget,
        timer: null,
        active: false,
        preview: [...groupedOrder],
      };
      if (event.pointerType === "touch") {
        drag.touchMoveListener = (touchEvent: Event) => {
          if (drag.active && touchEvent.cancelable) touchEvent.preventDefault();
        };
        drag.target.addEventListener("touchmove", drag.touchMoveListener, { passive: false });
      }
      drag.timer = setTimeout(() => {
        if (dragRef.current !== drag) return;
        drag.active = true;
        drag.timer = null;
        drag.target.setPointerCapture?.(drag.pointerId);
        setPreviewOrder(drag.preview);
        setDraggingId(id);
        onReorderStart?.();
      }, LONG_PRESS_MS);
      dragRef.current = drag;
    };
    const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (
          Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >
          PRESS_CANCEL_DISTANCE
        ) {
          if (drag.timer) clearTimeout(drag.timer);
          if (drag.touchMoveListener)
            drag.target.removeEventListener("touchmove", drag.touchMoveListener);
          dragRef.current = null;
        }
        return;
      }
      event.preventDefault();
      const draggedCompleted = completedIds.has(drag.id);
      const group = drag.preview.filter(
        (candidate) => completedIds.has(candidate) === draggedCompleted,
      );
      const others = group.filter((candidate) => candidate !== drag.id);
      const elements = new Map(
        Array.from(containerRef.current?.children ?? []).map((child) => {
          const element = child as HTMLElement;
          return [element.dataset.completionId, element] as const;
        }),
      );
      let insertion = others.length;
      for (let index = 0; index < others.length; index += 1) {
        const rect = elements.get(others[index])?.getBoundingClientRect();
        if (rect && event.clientY < rect.top + rect.height / 2) {
          insertion = index;
          break;
        }
      }
      const reorderedGroup = [...others];
      reorderedGroup.splice(insertion, 0, drag.id);
      const next = mergeSubsetOrder(drag.preview, reorderedGroup);
      if (sameOrder(next, drag.preview)) return;
      beforeRectsRef.current = captureRects();
      drag.preview = next;
      setPreviewOrder(next);
    };
    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: ((event) =>
        finishDrag(event.pointerId, false)) as PointerEventHandler<HTMLElement>,
      onPointerCancel: ((event) =>
        finishDrag(event.pointerId, true)) as PointerEventHandler<HTMLElement>,
    };
  };

  return (
    <div ref={containerRef} className={className}>
      {effectiveOrder.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <div
            key={id}
            data-completion-id={id}
            {...bindingsFor(id)}
            onClickCapture={(event) => {
              if (Date.now() < suppressClickUntil.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            className={`completion-list-item touch-pan-y transition-[transform,filter,opacity] ${
              draggingId === id ? "relative z-20 scale-[1.02] opacity-95 drop-shadow-lg" : ""
            }`}
          >
            {renderItem(item, (completed) => scheduleMove(id, completed))}
          </div>
        );
      })}
    </div>
  );
}

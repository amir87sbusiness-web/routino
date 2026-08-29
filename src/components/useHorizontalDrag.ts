import { useEffect, useRef, type PointerEventHandler } from "react";

export interface HorizontalDragSample {
  dx: number;
  velocityX: number;
  pointerId: number;
  cancelled: boolean;
}

export interface HorizontalDragOptions {
  disabled?: boolean;
  activationDistance?: number;
  maxDistance?: number;
  onStart?: (sample: HorizontalDragSample) => void;
  onMove: (sample: HorizontalDragSample) => void;
  onEnd: (sample: HorizontalDragSample) => void;
}

export interface HorizontalDragBindings {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
}

type Intent = "pending" | "horizontal" | "vertical";

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  intent: Intent;
  started: boolean;
  target: HTMLElement;
}

function clamp(value: number, maxDistance?: number): number {
  if (maxDistance === undefined) return value;
  return Math.max(-maxDistance, Math.min(maxDistance, value));
}

/**
 * Pointer-event horizontal drag that keeps per-frame movement outside React
 * state. `touch-action: pan-y` belongs on the bound element so vertical page
 * scrolling stays native.
 */
export function useHorizontalDrag(options: HorizontalDragOptions): HorizontalDragBindings {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dragRef = useRef<DragState | null>(null);
  const latestRef = useRef<HorizontalDragSample | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancelFrame = () => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  const deliverLatest = () => {
    if (frameRef.current === null) return;
    cancelFrame();
    const sample = latestRef.current;
    if (sample) optionsRef.current.onMove(sample);
  };

  const scheduleLatest = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const sample = latestRef.current;
      if (sample) optionsRef.current.onMove(sample);
    });
  };

  const finish = (pointerId: number, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;

    if (drag.intent === "horizontal") {
      deliverLatest();
      const sample = latestRef.current ?? {
        dx: 0,
        velocityX: 0,
        pointerId,
        cancelled,
      };
      optionsRef.current.onEnd({ ...sample, cancelled });
      if (drag.target.hasPointerCapture?.(pointerId)) drag.target.releasePointerCapture(pointerId);
    } else {
      cancelFrame();
    }

    dragRef.current = null;
    latestRef.current = null;
  };

  useEffect(
    () => () => {
      cancelFrame();
      const drag = dragRef.current;
      if (drag?.target.hasPointerCapture?.(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
      dragRef.current = null;
      latestRef.current = null;
    },
    [],
  );

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (optionsRef.current.disabled || dragRef.current) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocityX: 0,
      intent: "pending",
      started: false,
      target: event.currentTarget,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rawDx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.intent === "pending") {
      const distance = Math.hypot(rawDx, dy);
      if (distance < (optionsRef.current.activationDistance ?? 6)) return;
      drag.intent = Math.abs(rawDx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (drag.intent === "vertical") return;
      drag.target.setPointerCapture?.(event.pointerId);
    }
    if (drag.intent !== "horizontal") return;

    event.preventDefault();
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    const instantVelocity = (event.clientX - drag.lastX) / elapsed;
    drag.velocityX = drag.velocityX * 0.35 + instantVelocity * 0.65;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    const sample: HorizontalDragSample = {
      dx: clamp(rawDx, optionsRef.current.maxDistance),
      velocityX: drag.velocityX,
      pointerId: event.pointerId,
      cancelled: false,
    };
    latestRef.current = sample;
    if (!drag.started) {
      drag.started = true;
      optionsRef.current.onStart?.(sample);
    }
    scheduleLatest();
  };

  const endWith = (event: Parameters<PointerEventHandler<HTMLElement>>[0], cancelled: boolean) => {
    finish(event.pointerId, cancelled);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event) => endWith(event, false),
    onPointerCancel: (event) => endWith(event, true),
  };
}

import type { Lang } from "./dates";

export interface WeekSwipeInput {
  dx: number;
  velocityX: number;
  width: number;
  lang: Lang;
}

export interface WeekSettleDurationInput {
  remainingDistance: number;
  velocityX: number;
  targetDirection: -1 | 0 | 1;
}

export function weekSettleDuration({
  remainingDistance,
  velocityX,
  targetDirection,
}: WeekSettleDurationInput): number {
  const distanceMs = Math.min(140, Math.max(0, remainingDistance) * 0.5);
  const velocityReductionMs = Math.min(140, Math.max(0, velocityX * targetDirection) * 100);
  return Math.round(Math.max(180, Math.min(320, 180 + distanceMs - velocityReductionMs)));
}

/** Calendar delta for a physical drag. Positive means the following week. */
export function resolveWeekSwipe({ dx, velocityX, width, lang }: WeekSwipeInput): -1 | 0 | 1 {
  const distanceThreshold = Math.min(72, Math.max(0, width) * 0.22);
  const crossedDistance = Math.abs(dx) >= distanceThreshold;
  const deliberateFlick = Math.abs(dx) >= 18 && Math.abs(velocityX) >= 0.55;
  if (!crossedDistance && !deliberateFlick) return 0;

  const physicalDirection = dx > 0 ? 1 : -1;
  return (lang === "fa" ? physicalDirection : -physicalDirection) as -1 | 1;
}

/** Week deltas rendered in physical left, center, right order. */
export function weekPanelShifts(lang: Lang): readonly [-1 | 1, 0, -1 | 1] {
  return lang === "fa" ? [1, 0, -1] : [-1, 0, 1];
}

/** Physical drag sign that reveals a semantic previous/next week panel. */
export function dragDirectionForWeekShift(shift: -1 | 1, lang: Lang): -1 | 1 {
  return (lang === "fa" ? shift : -shift) as -1 | 1;
}

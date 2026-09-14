export const BUILD_SNAPS = [
  0.305, 0.349, 0.429, 0.619, 0.682, 0.732, 0.82, 0.952, 1.131, 1.181, 1.269,
  1.401, 1.503, 1.582, 1.75, 1.802, 1.888, 2.019, 2.121, 2.201, 2.391, 2.52,
  2.582, 2.622, 2.668, 2.708, 2.79, 2.867, 2.941, 3.009, 3.049, 3.091, 3.177,
  3.227,
] as const;

export const SETTLE_AT = 3.28;
export const SETTLE_DURATION = 0.18;
export const AUDIO_DURATION = 3.513;

export const INTRO_HOLD = 0.18;

export function assignSnapTimes(
  count: number,
  snaps: readonly number[] = BUILD_SNAPS,
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [snaps[0] ?? 0.3];

  if (count <= snaps.length) {
    return Array.from({ length: count }, (_, index) => {
      const pos = (index * (snaps.length - 1)) / (count - 1);
      return snaps[Math.round(pos)] ?? snaps[0];
    });
  }

  return Array.from({ length: count }, (_, index) => {
    const pos = (index * (snaps.length - 1)) / (count - 1);
    const low = Math.floor(pos);
    const high = Math.min(low + 1, snaps.length - 1);
    const frac = pos - low;
    if (frac < 0.001 || frac > 0.999) return snaps[Math.round(pos)];
    const base = frac < 0.5 ? snaps[low] : snaps[high];
    const sibling = frac < 0.5 ? snaps[high] : snaps[low];
    const nudge = Math.min(0.012, Math.abs(sibling - base) * 0.25);
    return base + (frac < 0.5 ? nudge : -nudge);
  });
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}

export function easeInCubic(t: number): number {
  const c = clamp01(t);
  return c * c * c;
}

export function easeOutQuad(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type MotionTiming = {
  liftStart: number;
  liftDur: number;
  travelDur: number;
  alignDur: number;
  dropDur: number;
  snapAt: number;
};

export function motionTiming(snapAt: number, index: number, total: number): MotionTiming {
  const pace = total <= 1 ? 0 : index / (total - 1);
  let liftDur = lerp(0.12, 0.07, pace);
  let travelDur = lerp(0.28, 0.13, pace);
  let alignDur = lerp(0.1, 0.05, pace);
  let dropDur = lerp(0.1, 0.05, pace);

  const ideal = liftDur + travelDur + alignDur + dropDur;
  const available = Math.max(0.18, snapAt - INTRO_HOLD);
  if (ideal > available) {
    const scale = available / ideal;
    liftDur *= scale;
    travelDur *= scale;
    alignDur *= scale;
    dropDur *= scale;
  }

  const liftStart = snapAt - liftDur - travelDur - alignDur - dropDur;
  return { liftStart, liftDur, travelDur, alignDur, dropDur, snapAt };
}

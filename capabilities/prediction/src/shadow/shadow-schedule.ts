import type { Predicts } from '../document/prediction-document.ts';
import { closeOf, enclosingOf } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import { periodOfMoment } from '../periods/moments.ts';

export interface ShadowOrigin {
  readonly origin: number;
  readonly form: string;
  readonly closesAt: number;
}

export interface ShadowTarget {
  readonly form: string;
  readonly closesAt: number;
  readonly horizon: number | null;
  readonly first: number;
  readonly last: number;
}

export function shadowOrigins(
  { period, accumulates }: Predicts,
  builtAt: number,
  closes: number,
): readonly ShadowOrigin[] {
  return Array.from({ length: closes }, (_, close) => {
    const origin =
      accumulates === undefined
        ? periodOfMoment(period, builtAt) + close
        : periodOfMoment(period, closeOf(accumulates, periodOfMoment(accumulates, builtAt) + close)) - 1;
    return { origin, form: periodForm(period, origin), closesAt: closeOf(period, origin) };
  });
}

export function targetsOf({ period, accumulates, horizons }: Predicts, origin: number): readonly ShadowTarget[] {
  if (accumulates === undefined) {
    return horizons.map((horizon) => ({
      form: periodForm(period, origin + horizon),
      closesAt: closeOf(period, origin + horizon),
      horizon,
      first: origin + horizon,
      last: origin + horizon,
    }));
  }
  const next = enclosingOf(period, accumulates, origin + 1);
  const closesAt = closeOf(accumulates, next);
  return [
    {
      form: periodForm(accumulates, next),
      closesAt,
      horizon: null,
      first: origin + 1,
      last: periodOfMoment(period, closesAt) - 1,
    },
  ];
}

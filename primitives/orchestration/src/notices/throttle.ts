export type Admission = { readonly admitted: false } | { readonly admitted: true; readonly suppressed: number };

export interface Throttle {
  readonly admit: (now: number) => Admission;
}

export function makeThrottle(windowMs: number): Throttle {
  let opened: number | undefined;
  let suppressed = 0;
  return {
    admit: (now) => {
      if (opened !== undefined && now - opened < windowMs) {
        suppressed += 1;
        return { admitted: false };
      }
      const admission: Admission = { admitted: true, suppressed };
      opened = now;
      suppressed = 0;
      return admission;
    },
  };
}

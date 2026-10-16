import { getEventListeners } from 'node:events';

import { expect, vi } from 'vitest';

export const patiently = { timeout: 30_000, interval: 10 };

export const longerThanTheTestMs = 120_000;

export function until(event: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    expect(event()).toBe(true);
  }, patiently);
}

export function isWatched(signal: Readonly<AbortSignal>): boolean {
  return getEventListeners(signal, 'abort').length > 0;
}

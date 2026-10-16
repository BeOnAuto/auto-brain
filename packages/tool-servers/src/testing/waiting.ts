import { getEventListeners } from 'node:events';

import { expect, vi } from 'vitest';

const patiently = { timeout: 30_000, interval: 10 };

export function until(holds: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    expect(holds()).toBe(true);
  }, patiently);
}

export function isWatched(signal: Readonly<AbortSignal>): boolean {
  return getEventListeners(signal, 'abort').length > 0;
}

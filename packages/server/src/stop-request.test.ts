import { describe, expect, it } from 'vitest';

import { stopRequestedBy, type StopSignal } from './stop-request.ts';

describe('stopRequestedBy', () => {
  it.each<StopSignal>(['SIGTERM', 'SIGINT'])('is requested by %s', async (signal) => {
    const signals = new EventTarget();

    const stopRequested = stopRequestedBy({
      on: (name, listener) => {
        signals.addEventListener(name, listener);
      },
    });
    signals.dispatchEvent(new Event(signal));

    await expect(stopRequested).resolves.toBeUndefined();
  });
});

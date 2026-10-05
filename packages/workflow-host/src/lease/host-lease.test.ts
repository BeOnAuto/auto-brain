import { describe, expect, it } from 'vitest';

import { leaseMsFor, shortestLeaseMs } from './host-lease.ts';

describe('the claim of a host on the workflows of its database', () => {
  it('lasts three sweeps, and never less than ten seconds', () => {
    expect([leaseMsFor(10), leaseMsFor(1000), leaseMsFor(5000)]).toEqual([shortestLeaseMs, shortestLeaseMs, 15_000]);
  });
});

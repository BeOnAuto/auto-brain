import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { filterInstances, hostClock, machineSandboxOf } from './host-sandboxes.ts';

describe('the sandboxes of a host', () => {
  it('reserves an instance of 64 MiB for each input of a workflow, read against the clock of the host by default', async () => {
    const sandbox = machineSandboxOf();
    const counted = machineSandboxOf(() => 12);

    await Effect.runPromise(sandbox.reserve);
    const taken = sandbox.take();

    expect(taken.memoryBytes).toBe(unitMemoryBytes);
    expect(sandbox.clock).toBe(hostClock);
    expect(counted.clock()).toBe(12);
    expect(hostClock()).toBeGreaterThan(0);
  });

  it('makes an instance of 64 MiB for each batch of filters', async () => {
    const instances = filterInstances();

    expect((await instances()).memoryBytes).toBe(unitMemoryBytes);
  });
});

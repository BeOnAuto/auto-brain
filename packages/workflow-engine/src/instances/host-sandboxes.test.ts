import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Evaluation } from '../programs/program-run.ts';
import { filterSandboxOf, hostClock, machineSandboxOf } from './host-sandboxes.ts';

const evaluation: Evaluation = { budget: 250, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

const fits = '"x".repeat(16 * 1024 * 1024).length';

const overflows = '"x".repeat(96 * 1024 * 1024).length';

describe('the sandboxes of a host', () => {
  it('reserves an instance of 64 MiB for each input of a workflow, read against the clock of the host by default', async () => {
    const sandbox = machineSandboxOf();
    const counted = machineSandboxOf(() => 12);

    await Effect.runPromise(sandbox.reserve);
    const unit = sandbox.unit();
    const runs = [unit.evaluate(fits, {}, evaluation), unit.evaluate(overflows, {}, evaluation)];
    unit.close();

    expect(runs).toMatchObject([
      { ran: 'answered', text: String(16 * 1024 * 1024) },
      { ran: 'exhausted', limit: 'memory' },
    ]);
    expect(sandbox.clock).toBe(hostClock);
    expect(counted.clock()).toBe(12);
    expect(hostClock()).toBeGreaterThan(0);
  });

  it('opens a context on an instance of 64 MiB for each group of filters, read against the clock of the host by default', async () => {
    const sandbox = filterSandboxOf();

    const context = await sandbox.context(() => evaluation);
    const [fitting, overflowing] = [context.define(fits), context.define(overflows)];
    context.freeze();
    const runs = [fitting('null', evaluation), overflowing('null', evaluation)];
    context.close();

    expect(runs).toMatchObject([
      { ran: 'answered', text: String(16 * 1024 * 1024) },
      { ran: 'exhausted', limit: 'memory' },
    ]);
    expect(sandbox.clock).toBe(hostClock);
  });
});

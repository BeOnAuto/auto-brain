import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { definePrimitive, mostCallDepth } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const calledBy = { execution_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/ask', run: 2 } as const;

const measuring = definePrimitive({
  name: 'measuring',
  title: 'Measuring',
  description: 'Answers with how long the runs of definitions it names may take, and how deep it was called.',
  noun: { one: 'measure', other: 'measures' },
  describeOutput: () => 'It measured.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  longestRunOf: () => 42_000,
  execute: (_source, _input, execution) =>
    Effect.gen(function* () {
      const longest = [
        yield* execution.longestRunOf('probe', 'plain'),
        yield* execution.longestRunOf('measuring', 'itself'),
        yield* execution.longestRunOf('probe', 'missing'),
        yield* execution.longestRunOf('probe', 'retired'),
        yield* execution.longestRunOf('nothing', 'at-all'),
      ];
      return { output: { longest: longest.map((ms) => ms ?? null), callDepth: execution.callDepth }, record: {} };
    }),
});

async function brainMeasuring() {
  const operations = specOperationsFor([measuring, probe().primitive]);
  const specs = harness();
  const created = (primitive: string, name: string) =>
    specs.call(operations.createSpec, toAlpha(acmeAdmin, { primitive, name, source: 'text' }));
  await created('measuring', 'itself');
  await created('probe', 'plain');
  await created('probe', 'retired');
  await specs.call(operations.retireSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'retired' }));
  const measured = (depths: { readonly callDepth?: number; readonly calledBy?: typeof calledBy } = {}) =>
    specs.call(operations.executeSpec, {
      ...toAlpha(acmeAdmin, { primitive: 'measuring', name: 'itself', execution_id: executionId }),
      ...depths,
    });
  return { ...specs, ...operations, measured };
}

describe('a run that answers a call of another run', () => {
  it('records the call and how many calls are above it on its start, and sees that depth in its context', async () => {
    const { ledger, measured, run } = await brainMeasuring();

    expect(await measured({ callDepth: 3, calledBy })).toMatchObject({
      output: { output: { callDepth: 3 } },
    });
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', brain: 'alpha' },
          { kind: 'run', execution: executionId },
          { order: 'asc', limit: 10 },
        ),
      ),
    );
    expect(records[0]?.data).toMatchObject({ type: 'execution_started', call_depth: 3, called_by: calledBy });
  });

  it(`may be ${mostCallDepth} calls deep, and the ninth start is refused as a conflict that records nothing`, async () => {
    const deep = await brainMeasuring();
    const deeper = await brainMeasuring();

    expect(await deep.measured({ callDepth: mostCallDepth })).toMatchObject({ status: 'succeeded' });
    expect(await deeper.measured({ callDepth: mostCallDepth + 1 })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'This run would sit 9 calls below the run at the top of its tree, more than the 8 a run may: workflows that call workflows reach at most 8 calls deep',
    });
    expect(deeper.ledger.streamNames().filter((stream) => stream.includes('/executions/'))).toEqual([]);
  });
});

describe('the longest run of a definition, as a run resolves it', () => {
  it('is what the capability declares for the active latest version, and nothing for one it cannot run', async () => {
    const { measured } = await brainMeasuring();

    expect(await measured()).toMatchObject({
      output: { output: { longest: [600_000, 42_000, null, null, null], callDepth: 0 } },
    });
  });
});

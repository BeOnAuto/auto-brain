import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ExecutionEventSchema } from './execution-events.ts';
import { runStartedOf } from './run-starts.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(ExecutionEventSchema));

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:00.000Z' };

describe('the start of a run read from its record', () => {
  it('names what ran and its reaction depth, and nothing for any other record', () => {
    expect([
      runStartedOf(
        encode({
          type: 'execution_started',
          primitive: 'orchestration',
          name: 'close',
          spec_version: 1,
          input: {},
          depth: 2,
          ...fact,
        }),
      ),
      runStartedOf(
        encode({ type: 'execution_started', primitive: 'inference', name: 'sum', spec_version: 1, input: {}, ...fact }),
      ),
      runStartedOf(encode({ type: 'execution_failed', primitive: 'inference', name: 'sum', spec_version: 1, ...fact })),
      runStartedOf('not a record'),
    ]).toEqual([
      { primitive: 'orchestration', name: 'close', depth: 2 },
      { primitive: 'inference', name: 'sum', depth: 0 },
      undefined,
      undefined,
    ]);
  });
});

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RunEventSchema } from './run-events.ts';
import { runStartedOf } from './run-starts.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(RunEventSchema));

const fact = { by: 'brain:alpha', at: '2026-10-01T09:00:00.000Z' };

describe('the start of a run read from its record', () => {
  it('names what ran and its reaction depth, and nothing for any other record', () => {
    expect([
      runStartedOf(
        encode({
          type: 'run_started',
          definition_type: 'workflow',
          name: 'close',
          definition_version: 1,
          input: {},
          depth: 2,
          ...fact,
        }),
      ),
      runStartedOf(
        encode({
          type: 'run_started',
          definition_type: 'reasoning',
          name: 'sum',
          definition_version: 1,
          input: {},
          ...fact,
        }),
      ),
      runStartedOf(
        encode({ type: 'run_failed', definition_type: 'reasoning', name: 'sum', definition_version: 1, ...fact }),
      ),
      runStartedOf('not a record'),
    ]).toEqual([
      { type: 'workflow', name: 'close', depth: 2 },
      { type: 'reasoning', name: 'sum', depth: 0 },
      undefined,
      undefined,
    ]);
  });
});

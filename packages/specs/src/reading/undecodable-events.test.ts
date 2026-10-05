import type { Decider } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const BrokenSchema = Schema.Struct({ type: Schema.Literal('execution_started'), at: Schema.String });

const broken: Decider<null, typeof BrokenSchema.Type, typeof BrokenSchema.Type> = {
  initialState: null,
  evolve: (state) => state,
  decide: (event) => Result.succeed([event]),
  eventSchema: BrokenSchema,
};

describe('a stored event of an execution that no longer decodes', () => {
  it('fails the list of runs and the read of its history', async () => {
    const { getExecutionHistory, listExecutions } = specOperationsFor([echo]);
    const { call, ledger, run } = harness();
    await run(
      Effect.orDie(
        ledger.service.execute(`brain/acme/alpha/executions/${executionId}`, broken, {
          type: 'execution_started',
          at: '2026-10-01T09:00:00.000Z',
        }),
      ),
    );

    expect(await call(getExecutionHistory, toAlpha(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      status: 'failed',
    });
    expect(await call(listExecutions, toAlpha(acmeAdmin))).toMatchObject({ status: 'failed' });
  });
});

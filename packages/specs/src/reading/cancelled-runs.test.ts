import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionSettler } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toBrain } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

describe('a cancelled run in the list of runs', () => {
  it('shows the reason cancelled with its kind, as rejected, and is kept by the status rejected', async () => {
    const { call, executing, ledger, listExecutions, run } = await withHandOn();
    await executing();
    await run(
      Effect.orDie(
        executionSettler(ledger.service)(
          { org: 'acme', brain: 'alpha', id: relayedId },
          { status: 'rejected', reason: 'cancelled', detail: 'Not needed', kind: 'parent_ended' },
        ),
      ),
    );

    expect(await call(listExecutions, toBrain('acme', 'alpha')(acmeAdmin, { status: 'rejected' }))).toMatchObject({
      output: {
        executions: [
          { execution_id: relayedId, status: 'rejected', rejection: { reason: 'cancelled', kind: 'parent_ended' } },
        ],
      },
    });
  });
});

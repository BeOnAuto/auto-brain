import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

describe('a run whose input and output hold U+0000', () => {
  it('lists, filters and reads like any other', async () => {
    const { createSpec, executeSpec, getExecutionHistory, listExecutions } = specOperationsFor([echo]);
    const { call } = harness();
    await call(
      createSpec,
      toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting":"Hi\\u0000"}' }),
    );
    await call(
      executeSpec,
      toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', input: { text: 'a\u0000b' }, execution_id: executionId }),
    );

    expect(
      await call(listExecutions, toAlpha(acmeAdmin, { status: 'succeeded', name: 'greet', primitive: 'echo' })),
    ).toMatchObject({ status: 'succeeded', output: { executions: [{ execution_id: executionId }] } });
    expect(await call(getExecutionHistory, toAlpha(acmeAdmin, { execution_id: executionId }))).toMatchObject({
      status: 'succeeded',
      output: { events: [{ data: { input_bytes: 19 } }, { data: { output_bytes: 51 } }] },
    });
  });
});

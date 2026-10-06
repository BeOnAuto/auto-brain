import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const header = `document:
  dsl: '1.0.3'
  namespace: acme
  name: again
  version: '1.0.0'
`;

const raisingAgain = `use:
  errors:
    unfinished: { type: https://on.auto/problems/tools_unfinished, status: 503, kind: tools_unfinished }
do:
  - lookup:
      try:
        - fetch:
            call: execute_spec
            with: { primitive: inference, name: lookup, input: {} }
      catch:
        as: failure
        do:
          - report:
              raise:
                error:
                  type: '\${ $failure.type }'
                  status: 503
                  detail: '\${ $failure.detail }'
                  kind: '\${ $failure.kind }'
                  because: '\${ $failure.because }'
`;

describe('an error raised again from the one a workflow caught', () => {
  it('may name its kind and because, in a raise or under use.errors, which the DSL takes', async () => {
    const parsed = await Effect.runPromise(Effect.result(parseWorkflowDocument(`${header}${raisingAgain}`)));

    expect(Result.isSuccess(parsed)).toBe(true);
  });

  it('is still refused when it is not an error at all', async () => {
    const parsed = await Effect.runPromise(
      Effect.result(
        parseWorkflowDocument(`${header}use:\n  errors:\n    busy: oops\ndo:\n  - fail: { raise: { error: busy } }\n`),
      ),
    );

    expect(Result.isFailure(parsed)).toBe(true);
  });

  it('keeps its kind and because, so the run ends as the function it called did', async () => {
    const { settlement } = await interpret(workflow(raisingAgain), {
      respond: () => ({
        status: 'rejected',
        reason: 'unavailable',
        detail: 'A tool server kept failing',
        kind: 'tools_unfinished',
        because: 'server_failed',
      }),
    });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail:
        'https://on.auto/problems/tools_unfinished: A tool server kept failing (at /do/0/lookup/catch/do/0/report)',
      kind: 'tools_unfinished',
      because: 'server_failed',
    });
  });
});

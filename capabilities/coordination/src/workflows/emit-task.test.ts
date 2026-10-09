import { describe, expect, it } from 'vitest';

import { workflowPolicy } from '../document/workflow-functions.ts';
import { interpret, workflow } from '../testing/workflows.ts';

function emitting(attributes: string) {
  return workflow(`
do:
  - announce: { emit: { event: { with: ${attributes} } } }
`);
}

describe('a workflow that emits an event', () => {
  it('hands the event to its brain with an id the runtime gives it, and goes on', async () => {
    const document = emitting("{ type: com.acme.closed, source: /acme/ledger, data: { month: '${ $data.month }' } }");

    const { ending, commands } = await interpret(document, { input: { month: 'september' } });

    expect(ending).toEqual({ kind: 'completed', output: { month: 'september' } });
    expect(commands.filter(({ kind }) => kind === 'emitted')).toMatchObject([
      {
        kind: 'emitted',
        event: { specversion: '1.0', type: 'com.acme.closed', source: '/acme/ledger', data: { month: 'september' } },
      },
    ]);
  });

  it('is refused when it is saved with a type or a source the brain records itself', () => {
    const document = emitting('{ type: run_succeeded, source: /runs/0199a3c4 }');

    expect(workflowPolicy(document).map(({ pointer, detail }) => `${pointer}: ${detail}`)).toEqual([
      '/do/0/announce/emit/event/with/type: The type run_succeeded is one the brain records itself; give the event a type of your own',
      '/do/0/announce/emit/event/with/source: The source /runs/0199a3c4 is one the brain records itself; give the event a source of your own',
    ]);
  });

  it('fails when the event it computes is not one the brain takes', async () => {
    const { ending } = await interpret(emitting(`{ type: com.acme.closed, source: '\${ "/callers/someone" }' }`));

    expect(ending).toEqual({
      kind: 'failed',
      type: 'UncaughtError',
      message:
        'The event to emit is not one the brain takes: Expected a source of your own, not one under /runs/, /definitions/ or /callers/, which the brain records itself (at source) (at /do/0/announce)',
    });
  });
});

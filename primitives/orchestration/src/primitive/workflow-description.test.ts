import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import type { SpecCall, SpecCallResult } from '../testing/run-terms.ts';
import { interpret, yamlObject } from '../testing/workflows.ts';
import { workflowDescription, workflowExample } from './workflow-description.ts';

const example = yamlObject(workflowExample);

function triagedAs(urgency: string): (call: SpecCall) => SpecCallResult {
  return ({ name }) =>
    name === 'classify-ticket'
      ? { status: 'succeeded', output: { category: 'billing', urgency } }
      : { status: 'succeeded', output: 'Refund failed twice; the customer is waiting.' };
}

describe('the opening of the workflow description', () => {
  it('describes the workflow and preserves the name its tools take', () => {
    expect(workflowDescription).toMatch(
      /^A workflow coordinates the brain's functions, running them in order, deciding what happens next and waiting for input. Use workflow in conversation. The tools identify workflows with `primitive: orchestration`. Runs deterministic steps/u,
    );
  });
});

describe('the example in the workflow description', () => {
  it('is in the description, and stores as a valid spec document', async () => {
    expect(workflowDescription).toContain(workflowExample);
    await expect(Effect.runPromise(parseWorkflowDocument(workflowExample))).resolves.toEqual(example);
  });

  it('drafts a note for an urgent ticket and hands on what the approval event carried', async () => {
    const { ending } = await interpret(example, {
      input: { ticket: 'I was charged twice' },
      respond: triagedAs('high'),
      started: (start) => {
        start.deliver({ id: 'a1', type: 'com.acme.escalation.approved', data: { by: 'dana' } });
      },
    });

    expect(ending).toEqual({
      kind: 'completed',
      output: {
        ticket: 'I was charged twice',
        triage: { category: 'billing', urgency: 'high' },
        note: 'Refund failed twice; the customer is waiting.',
        approved_by: 'dana',
      },
    });
  });

  it('skips the note and the approval for a ticket that is not urgent, handing its input on', async () => {
    const { ending } = await interpret(example, { input: { ticket: 'How do I export?' }, respond: triagedAs('low') });

    expect(ending).toEqual({
      kind: 'completed',
      output: { ticket: 'How do I export?', triage: { category: 'billing', urgency: 'low' } },
    });
  });
});

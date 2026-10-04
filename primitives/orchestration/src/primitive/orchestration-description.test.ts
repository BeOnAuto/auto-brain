import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import type { SpecCall, SpecCallResult } from '../interpreter/host.ts';
import { interpret, yamlObject } from '../testing/workflows.ts';
import { orchestrationDescription, orchestrationExample } from './orchestration-description.ts';

const example = yamlObject(orchestrationExample);

function triagedAs(urgency: string): (call: SpecCall) => SpecCallResult {
  return ({ name }) =>
    name === 'classify-ticket'
      ? { status: 'succeeded', output: { category: 'billing', urgency } }
      : { status: 'succeeded', output: 'Refund failed twice; the customer is waiting.' };
}

describe('the opening of the description of orchestration', () => {
  it('says that a spec of orchestration is a workflow, and which name the tools take', () => {
    expect(orchestrationDescription).toMatch(
      /^A spec of the orchestration primitive is a workflow: steps that run other specs of the brain, wait for events and decide what happens next. In conversation, call it a workflow; the primitive's name, `orchestration`, is what the tools take. Runs a workflow:/u,
    );
  });
});

describe('the example in the description of orchestration', () => {
  it('is in the description, and stores as a valid spec document', async () => {
    expect(orchestrationDescription).toContain(orchestrationExample);
    await expect(Effect.runPromise(parseWorkflowDocument(orchestrationExample))).resolves.toEqual(example);
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

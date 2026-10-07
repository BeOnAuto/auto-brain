import { describe, expect, it } from 'vitest';

import { interactionBounds } from '../run/run-bounds.ts';
import { interactionHarness } from '../testing/index.ts';
import { defineAnswerInteraction } from './answer-interaction.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const answer = defineAnswerInteraction({ channels: new Map(), secrets: [] });

const anyAnswer = [
  '---',
  'channel: inbox',
  "to: 'ada'",
  'expires: P2D',
  'output:',
  '  schema: {}',
  '---',
  'Anything?',
].join('\n');

type Nested = readonly Nested[] | string;

function nestedLevels(levels: number): Nested {
  return levels === 0 ? 'deep' : [nestedLevels(levels - 1)];
}

async function asked() {
  const brain = interactionHarness();
  await brain.define('anything', anyAnswer);
  await brain.ask('anything', {}, runId);
  return brain;
}

describe('the claim an answer makes', () => {
  it('takes 256 bytes and refuses one more, and refuses a blank claim or one with a control character', async () => {
    const brain = await asked();
    const answering = (claimedFor: string) =>
      brain.call(answer, { execution_id: runId, answer: 'yes', claimed_for: claimedFor });

    const refusals = [
      await answering(`${'é'.repeat(128)}a`),
      await answering('   '),
      await answering('the team\u0007'),
    ];
    const taken = await answering('é'.repeat(interactionBounds.claimBytes / 2));

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
    ]);
    expect(taken).toMatchObject({ status: 'succeeded', output: { status: 'succeeded', output: 'yes' } });
  });
});

describe('the depth of an answer', () => {
  it(`takes an answer ${interactionBounds.answerDepth} levels deep and refuses one level more`, async () => {
    const brain = await asked();

    const deeper = await brain.call(answer, {
      execution_id: runId,
      answer: nestedLevels(interactionBounds.answerDepth + 1),
    });
    const deepest = await brain.call(answer, {
      execution_id: runId,
      answer: nestedLevels(interactionBounds.answerDepth),
    });

    expect(deeper).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/answer', detail: `The answer nests more than ${interactionBounds.answerDepth} levels` }],
    });
    expect(deepest).toMatchObject({ status: 'succeeded', output: { status: 'succeeded' } });
  });
});

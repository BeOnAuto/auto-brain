import { allPermissions } from '@beonauto/operations';
import type { RunContext } from '@beonauto/specs';
import { noLongestRuns, recordingJournal } from '@beonauto/specs/testing';
import { Effect, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listInteractions } from '../requests/list-interactions.ts';
import { approvalDocument, interactionHarness, notificationDocument, webhookChannels } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

function containing(text: string): unknown {
  return expect.stringContaining(text);
}

const aRun: RunContext = {
  id: runId,
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' },
  spec: { name: 'approve-brief', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId },
  depth: 0,
  callDepth: 0,
  longestRunOf: noLongestRuns,
};

function openDocument(to: string, message: string, channel = 'inbox'): string {
  return [
    '---',
    `channel: ${channel}`,
    `to: '${to}'`,
    'expires: P1D',
    'output:',
    '  schema: { type: object }',
    '---',
    message,
  ].join('\n');
}

async function askedWith(source: string, input: unknown, channel?: string) {
  const brain = interactionHarness(
    channel === undefined ? {} : { channels: webhookChannels('https://partner.example.com/requests') },
  );
  await brain.define('ask', source);
  return brain.ask('ask', input, runId);
}

describe('a notification to the inbox', () => {
  it('succeeds at once with an empty output, keeping what it said, and waits for nothing', async () => {
    const brain = interactionHarness();
    await brain.define('tell', notificationDocument());

    expect(await brain.ask('tell', { campaign: 'Spring', owner: 'ada' }, runId)).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded', output: {} },
    });
    expect(await brain.runOf(runId)).toMatchObject({
      output: { record: { channel: 'inbox', to: 'ada', message: 'The brief for Spring is out.' } },
    });
    expect(await brain.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
  });
});

describe('a run that cannot ask now', () => {
  it('is unavailable through a channel the server does not offer, or when the brain holds all the requests it may', async () => {
    const brain = interactionHarness({ mostOpenRequests: 1 });
    await brain.define('approve', approvalDocument());
    await brain.define('elsewhere', approvalDocument('partner'));
    await brain.ask('approve', { campaign: 'Spring', owner: 'ada' }, runId);

    expect([
      await brain.ask('approve', { campaign: 'Autumn', owner: 'ada' }, otherRunId),
      await brain.ask('elsewhere', { campaign: 'Autumn', owner: 'ada' }, '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c'),
    ]).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'requests_full' },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'channel_not_offered',
        detail:
          'The interaction function asks through the channel “partner”, which this server does not offer to this brain',
      },
    ]);
  });
});

describe('a party the request cannot go to', () => {
  it.each([
    [
      'not text',
      { owner: { name: 'ada' } },
      'The party the request goes to renders a value that is not text on line 3',
    ],
    ['nothing', { owner: '  ' }, 'The party the request goes to renders to nothing'],
    ['a control character', { owner: 'ada\u0007' }, 'The party the request goes to holds a control character'],
    [
      'longer than 256 bytes',
      { owner: 'a'.repeat(257) },
      'The party the request goes to renders to more than the 256 bytes',
    ],
  ] as const)('ends the run as unworkable when it renders %s, at /to', async (_case, input, detail) => {
    expect(await askedWith(openDocument('{{ input.owner }}', 'Approve?'), input)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail: containing(detail),
    });
  });

  it('ends the run as unworkable when the channel does not allow the party', async () => {
    expect(
      await askedWith(openDocument('{{ input.owner }}', 'Approve?', 'partner'), { owner: 'Ada' }, 'partner'),
    ).toMatchObject({
      reason: 'conflict',
      detail: 'The party the request goes to is not one the channel “partner” allows',
    });
  });
});

describe('a message the request cannot carry', () => {
  it('ends the run as unworkable past 8 KiB, and rejects an input it cannot be rendered from', async () => {
    expect([
      await askedWith(openDocument('ada', '{{ input.text }}'), { text: 'x'.repeat(8193) }),
      await askedWith(openDocument('ada', 'For {{ input.campaign }}'), {}),
      await askedWith(openDocument('ada', '{% for row in input.rows %}{{ row.name }}{% endfor %}'), { rows: [{}] }),
      await askedWith(openDocument('ada', '{% for i in (1..100000000) %}{% endfor %}'), {}),
    ]).toMatchObject([
      {
        reason: 'conflict',
        kind: 'unworkable',
        detail: 'The message renders to more than the 8192 bytes a request may hold',
      },
      { reason: 'invalid_input', issues: [{ pointer: '/input/campaign' }] },
      { reason: 'invalid_input', issues: [{ pointer: '/input' }] },
      { reason: 'invalid_input', detail: 'The message cannot be rendered with this input' },
    ]);
  });

  it('rejects an input the input schema refuses, or nested deeper than a run takes', async () => {
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], 'x');
    const brain = interactionHarness();
    const prepared = Effect.runSync(brain.primitive.prepare(approvalDocument()));

    expect([
      await askedWith(approvalDocument(), { campaign: 'Spring' }),
      await Effect.runPromise(Effect.flip(prepared.execute({ campaign: deep, owner: 'ada' }, aRun))),
    ]).toMatchObject([
      { reason: 'invalid_input', detail: 'The input does not match the interaction function’s input schema' },
      { detail: 'The input nests more than the 512 levels an interaction function takes' },
    ]);
  });
});

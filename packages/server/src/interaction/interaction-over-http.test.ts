import { describe, expect, it } from 'vitest';

import { asking, servingInteractions } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

describe('an interaction function through the inbox, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('leaves its request in the inbox and takes a checked answer as the output, once', async () => {
    const server = await servingInteractions('inbox');
    const runId = await server.ask('approve-brief');

    const listed = await server.call('GET', `${alpha}/interactions?to=ada&function=approve-brief`);
    const invalid = await server.answer(runId, { answer: { choice: 'maybe' } });
    const answered = await server.answer(runId, { answer: { choice: 'approve' }, claimed_for: 'the campaign team' });
    const again = await server.answer(runId, { answer: { choice: 'approve' } });
    const another = await server.answer(runId, { answer: { choice: 'reject' } });
    const history = await server.call('GET', `${alpha}/executions/${runId}/history`);

    expect(listed).toMatchObject({ status: 200, body: { interactions: [{ execution_id: runId }] } });
    expect([invalid.status, answered.status, again.status, another.status]).toEqual([422, 200, 200, 409]);
    expect(invalid.body).toMatchObject({ errors: [{ pointer: '/answer/choice' }] });
    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(history.text).not.toContain('approve"');
  });

  it('ends a cancelled request as cancelled, which a late answer then finds ended', async () => {
    const server = await servingInteractions('inbox');
    const runId = await server.ask('approve-brief');

    await server.call('POST', `${alpha}/executions/${runId}/cancel`, { body: { reason: 'The brief was withdrawn' } });
    const settled = await server.settled(runId);
    const late = await server.answer(runId, { answer: { choice: 'approve' } });

    expect(settled).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', detail: 'The brief was withdrawn' },
    });
    expect([late.status, await server.openRequests(0)]).toEqual([409, []]);
  });

  it('succeeds a notification at once, with nothing left in the inbox', async () => {
    const server = await servingInteractions('inbox');
    const runId = await server.ask('brief-out');

    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: {} });
    expect((await server.call('GET', `${alpha}/interactions`)).body).toMatchObject({ interactions: [] });
  });
});

describe('a workflow that asks through the inbox', { timeout: workflowTestTimeoutMs }, () => {
  it('waits for the answer and takes it as the output of its step', async () => {
    const server = await servingInteractions('inbox');
    const workflowId = await server.workflow('approval', `do:\n${asking('approve-brief', 'approve')}`);

    const [request] = await server.openRequests(1);
    await server.answer(String(request), { answer: { choice: 'approve', note: 'Ship it' } });

    expect(await server.settled(workflowId)).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', note: 'Ship it' },
    });
  });
});

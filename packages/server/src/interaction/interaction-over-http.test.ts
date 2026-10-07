import { describe, expect, it } from 'vitest';

import { asking, brief, servingInteractions } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { executionIdIn, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

describe('an interaction function through the inbox, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('leaves its request in the inbox and takes a checked answer as the output, once', async () => {
    const server = await servingInteractions('inbox');
    const started = await server.call('POST', `${alpha}/specs/interaction/approve-brief/execute`, {
      body: { input: brief },
    });
    const runId = executionIdIn(started.body);

    const listed = await server.call('GET', `${alpha}/interactions?to=ada&function=approve-brief`);
    const invalid = await server.answer(runId, { answer: { choice: 'maybe' } });
    const answered = await server.answer(runId, { answer: { choice: 'approve' }, claimed_for: 'the campaign team' });
    const again = await server.answer(runId, { answer: { choice: 'approve' } });
    const another = await server.answer(runId, { answer: { choice: 'reject' } });
    const history = await server.call('GET', `${alpha}/executions/${runId}/history`);
    const analytics = await server.call('GET', `${alpha}/analytics?primitive=interaction`);

    expect(started).toMatchObject({ status: 200, body: { status: 'started' } });
    expect(listed).toMatchObject({ status: 200, body: { interactions: [{ execution_id: runId }] } });
    expect([invalid.status, answered.status, again.status, another.status]).toEqual([422, 200, 200, 409]);
    expect(invalid.body).toMatchObject({ errors: [{ pointer: '/answer/choice' }] });
    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(history.text).not.toContain('approve"');
    expect(analytics.body).toMatchObject({
      runs: { succeeded: 1 },
      by_function: [{ primitive: 'interaction', name: 'approve-brief', runs: 1 }],
    });
  });
});

describe(
  'an interaction function through the inbox that ends without an answer, over HTTP',
  { timeout: workflowTestTimeoutMs },
  () => {
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
  },
);

describe('a token for a brain that is missing or retired, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is refused as a bad token for a brain that exists is, so a token tells nothing of the brains', async () => {
    const server = await servingInteractions('inbox');
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'omega', name: 'Omega' } });
    await server.call('POST', '/v1/orgs/acme/brains/omega/retire', { body: {} });
    const answered = (brain: string) =>
      server.call('POST', `/v1/orgs/acme/brains/${brain}/executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/answer`, {
        body: { answer: { choice: 'approve' } },
        authorization: 'Request not-a-token-of-any-request',
      });

    const refusals = await Promise.all(['alpha', 'nobody', 'omega'].map((brain) => answered(brain)));

    expect(refusals.map(({ status, body }) => [status, body])).toEqual(
      refusals.map(() => [
        403,
        {
          type: 'https://on.auto/problems/forbidden',
          title: 'Forbidden',
          status: 403,
          reason: 'forbidden',
          detail: 'The token does not answer this request',
        },
      ]),
    );
  });
});

describe('input that does not fit, with a bad token, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('is refused as invalid input for a brain that exists, is missing or is retired', async () => {
    const server = await servingInteractions('inbox');
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'omega', name: 'Omega' } });
    await server.call('POST', '/v1/orgs/acme/brains/omega/retire', { body: {} });
    const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
    const malformed: readonly (readonly [string, unknown])[] = [
      [runId, {}],
      ['not-a-uuid', { answer: 'yes' }],
      [runId, { answer: 'yes', claimed_for: 'a'.repeat(300) }],
    ];
    const answered = (brain: string, [id, body]: readonly [string, unknown]) =>
      server.call('POST', `/v1/orgs/acme/brains/${brain}/executions/${id}/answer`, {
        body,
        authorization: 'Request not-a-token-of-any-request',
      });

    const statuses = await Promise.all(
      ['alpha', 'nobody', 'omega'].map((brain) =>
        Promise.all(malformed.map(async (asked) => (await answered(brain, asked)).status)),
      ),
    );

    expect(statuses).toEqual([
      [422, 422, 422],
      [422, 422, 422],
      [422, 422, 422],
    ]);
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

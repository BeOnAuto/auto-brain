import { approvalDocument } from '@beonauto/interaction/testing';
import { describe, expect, it } from 'vitest';

import { answeredAs, badAnswerTokens, requestIdOf } from '../testing/servers/bad-answer-tokens.ts';
import { servingInteractions } from '../testing/servers/interaction-server.ts';
import { decodeEvent, partnerChannel, partnerReceiver, receivedAtLeast } from '../testing/servers/partner-channels.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const targets = [
  '/v1/orgs/acme/brains/alpha',
  '/v1/orgs/acme/brains/nobody',
  '/v1/orgs/acme/brains/omega',
  '/v1/orgs/acme/brains/Not_A_Brain',
  '/v1/orgs/initech/brains/alpha',
  '/v1/orgs/initech/brains/nobody',
];

const refusal = JSON.stringify({
  type: 'https://on.auto/problems/forbidden',
  title: 'Forbidden',
  status: 403,
  detail: 'The token does not answer this request',
  reason: 'forbidden',
});

describe('a bad answer token, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('answers the same status, headers and body at every brain and org, whatever is wrong with it', async () => {
    const partner = await partnerReceiver();
    const server = await servingInteractions('partner', partnerChannel(partner.url));
    await server.call('POST', `${alpha}/specs/interaction`, {
      body: { name: 'ask-in-inbox', source: approvalDocument('inbox') },
    });
    await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'omega', name: 'Omega' } });
    await server.call('POST', '/v1/orgs/acme/brains/omega/retire', { body: {} });
    await server.ask('approve-brief');
    const [posted] = await receivedAtLeast(partner, 1);
    const inboxRun = await server.ask('ask-in-inbox');
    const tokens = badAnswerTokens(decodeEvent(posted?.body).data.answer_token, await requestIdOf(server, inboxRun));

    const answers = await Promise.all(
      tokens.flatMap((token) =>
        targets.map((target) => answeredAs(server, `${target}/executions/${inboxRun}/answer`, token)),
      ),
    );
    const [first] = answers;

    expect([answers.length, first?.[0], first?.[2]]).toEqual([48, 403, refusal]);
    expect(answers).toEqual(answers.map(() => first));
    expect(await server.openRequests(1)).toContain(inboxRun);
  });
});

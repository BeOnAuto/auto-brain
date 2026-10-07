import { describe, expect, it, vi } from 'vitest';

import {
  developmentFiles,
  developmentTestTimeoutMs,
  startDevelopment,
  untilListening,
} from '../testing/processes/development-process.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';

const meetings = '/v1/orgs/local/brains/meetings';

const echo = ['---', 'language: jq', 'input:', '  schema: {type: object}', '---', '.'].join('\n');

const saidSoFar = [
  '---',
  'language: jq',
  'source:',
  '  events:',
  '    - type: execution_succeeded',
  '      subject: computation/echo',
  'view:',
  '  initial: []',
  "answer: 'map(ascii_upcase)'",
  '---',
  '. + [$event.data.output.said]',
].join('\n');

describe('the functions pnpm dev serves in worker threads', { timeout: developmentTestTimeoutMs }, () => {
  it('runs a computation function, folds its runs into the view of a recall function and answers from the view', async () => {
    const development = startDevelopment(developmentFiles());
    const port = await untilListening(development);
    const call = (method: string, path: string, body?: unknown): Promise<TestResponse> =>
      request(port, method, path, { body });

    await call('POST', '/v1/orgs/local/brains', { brain: 'meetings', name: 'Meetings' });
    await call('POST', `${meetings}/specs/computation`, { name: 'echo', source: echo });
    const echoed = await call('POST', `${meetings}/specs/computation/echo/execute`, { input: { said: 'hello' } });
    expect(echoed.body).toMatchObject({ status: 'succeeded', output: { said: 'hello' } });
    await call('POST', `${meetings}/specs/recollection`, { name: 'said', source: saidSoFar });
    const recalled = await vi.waitFor(
      async () => {
        const answered = await call('POST', `${meetings}/specs/recollection/said/execute`, { input: {} });
        expect(answered.status).toBe(200);
        return answered;
      },
      { timeout: developmentTestTimeoutMs / 2, interval: 100 },
    );

    expect(recalled.body).toMatchObject({ status: 'succeeded', output: ['HELLO'] });
  });
});

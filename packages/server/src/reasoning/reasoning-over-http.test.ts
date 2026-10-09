import { answers, jsonResult, textResult, type ScriptedReply } from '@beonauto/reasoning/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

let server: ReasoningServer;

async function serving(...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  server = await servingReasoning(replies);
  await server.call('POST', '/v1/orgs/acme/brains', { body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'verdict', source: verdict } });
  return server;
}

function executing(name: string, body: object) {
  return server.call('POST', `${alpha}/definitions/reasoning/${name}/run`, { body });
}

afterEach(async () => {
  await server.stop();
});

describe('executing a reasoning function definition over HTTP', () => {
  it('answers with the run and the text of the model', async () => {
    await serving(answers(textResult('Profits rose.')));

    expect(await executing('summary', { input: { text: 'the quarter' } })).toMatchObject({
      status: 200,
      body: { type: 'reasoning', name: 'summary', definition_version: 1, status: 'succeeded', output: 'Profits rose.' },
    });
  });

  it('answers with the JSON value of a JSON definition', async () => {
    await serving(answers(jsonResult({ approve: true })));

    expect(await executing('verdict', { input: { expense: 'a dinner' } })).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: { approve: true } },
    });
  });
});

describe('the runs of a reasoning function definition over HTTP', () => {
  it('rejects an input that does not match the input schema with 422, under /input', async () => {
    await serving();

    expect(await executing('summary', { input: { text: 7 } })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/input/text', detail: 'Expected string' }] },
    });
    expect(server.modelCalls()).toBe(0);
  });

  it('answers a retry with the same run id from the record, without calling the model again', async () => {
    await serving(answers(textResult('Profits rose.')));
    const first = await executing('summary', { input: { text: 'the quarter' }, run_id: runId });
    const retried = await executing('summary', { input: { text: 'the quarter' }, run_id: runId });

    expect(first).toMatchObject({ status: 200, body: { run_id: runId, output: 'Profits rose.' } });
    expect(retried.body).toEqual(first.body);
    expect(server.modelCalls()).toBe(1);
  });

  it('shows the record of the run with get_run', async () => {
    await serving(answers(textResult('Profits rose.', { response_id: 'msg_01', duration_ms: 420 })));
    await executing('summary', { input: { text: 'the quarter' }, run_id: runId });

    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      status: 200,
      body: {
        run_id: runId,
        status: 'succeeded',
        output: 'Profits rose.',
        record: {
          model: { requested: 'scripted/model', resolved: 'scripted/model', answered: 'model' },
          settings: { max_output_tokens: 1024 },
          output_format: 'text',
          finish_reason: 'stop',
          response_id: 'msg_01',
          duration_ms: 420,
          prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter', truncated: false },
        },
      },
    });
  });
});

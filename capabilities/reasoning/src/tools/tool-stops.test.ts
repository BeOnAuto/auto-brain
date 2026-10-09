import { setTimeout } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { anthropicMessage } from '../testing/provider-replies.ts';
import { abortedWith, jsonResponse, recordingFetch, type Responder } from '../testing/recording-fetch.ts';
import { foundRows, scriptedTools, searchTool } from '../testing/scripted-tools.ts';
import { anthropicToolCall } from '../testing/tool-call-replies.ts';

const model = 'anthropic/claude-sonnet-4-5';

const callThenAnswer: Responder = (_request, attempt) =>
  jsonResponse(attempt === 1 ? anthropicToolCall(searchTool, { query: 'acme' }) : anthropicMessage('Acme has 2 rows.'));

const callThenHang: Responder = (request, attempt) =>
  attempt === 1 ? jsonResponse(anthropicToolCall(searchTool, { query: 'acme' })) : abortedWith(request.signal);

const callTwice: Responder = () => jsonResponse(anthropicToolCall(searchTool, { query: 'acme' }));

const refuse: Responder = () =>
  jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'The request is invalid' } }, 400);

const callWithAList: Responder = (_request, attempt) =>
  jsonResponse(attempt === 1 ? anthropicToolCall(searchTool, ['acme']) : anthropicMessage('No rows.'));

async function slowly() {
  await setTimeout(150);
  return foundRows;
}

async function run(responder: Responder) {
  const recording = recordingFetch(responder);
  const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });
  const bodies = () => recording.requests().map(({ body }) => JSON.stringify(body));
  const aborted = () => recording.requests().map(({ signal }) => signal.aborted);
  return { access, bodies, aborted };
}

describe('the steps of a run that may still call tools', () => {
  it('keeps offering the tools, with the answers in the form of the provider', async () => {
    const { tools } = scriptedTools({ endAfter: 2 });
    const { access, bodies } = await run(callThenAnswer);

    const result = await succeeded(access, textRequest(model, { tools }));

    expect(result.text).toBe('Acme has 2 rows.');
    expect(bodies()[1]).toContain('"tool_result"');
    expect(bodies()[1]).toContain(`"tools":[{"name":"${searchTool}"`);
  });

  it('gives the model a tool error as one', async () => {
    const { tools } = scriptedTools({ endAfter: 2, reply: () => Promise.resolve({ text: 'Denied.', isError: true }) });
    const { access, bodies } = await run(callThenAnswer);

    await succeeded(access, textRequest(model, { tools }));

    expect(bodies()[1]).toContain('"is_error":true');
  });

  it('refuses arguments that are not a JSON object without calling the tool', async () => {
    const { tools, calls } = scriptedTools();
    const { access, bodies } = await run(callWithAList);

    await succeeded(access, textRequest(model, { tools }));

    expect(calls()).toEqual([]);
    expect(bodies()[1]).toContain('The arguments of this call are not a JSON object, so it was not sent');
  });
});

describe('a last step that does not answer', () => {
  it('ends the run without an answer when the model still calls tools', async () => {
    const { tools } = scriptedTools();
    const { access } = await run(callTwice);

    expect(await failed(access, textRequest(model, { tools }))).toMatchObject({
      _tag: 'tools_stopped',
      because: 'no_answer',
      detail: 'anthropic kept calling tools in the step that withheld them, instead of answering',
    });
  });
});

describe('the deadlines of a run that calls tools', () => {
  it('gives each model call its own deadline, which the time of the tools does not count against', async () => {
    const { tools } = scriptedTools({ reply: slowly });
    const { access } = await run(callThenAnswer);

    expect(await succeeded(access, textRequest(model, { tools, timeout_ms: 100 }))).toMatchObject({
      text: 'Acme has 2 rows.',
    });
  });

  it('ends a model call that misses its deadline as timed out', async () => {
    const { tools } = scriptedTools();
    const { access } = await run(callThenHang);

    expect(await failed(access, textRequest(model, { tools, timeout_ms: 100 }))).toMatchObject({
      _tag: 'timed_out',
      detail: 'anthropic did not answer within 100 ms',
    });
  });

  it('ends the deadline of a model call that failed with it, so it aborts nothing once the call is over', async () => {
    const { tools } = scriptedTools();
    const { access, aborted } = await run(refuse);

    expect(await failed(access, textRequest(model, { tools, timeout_ms: 50 }))).toMatchObject({
      _tag: 'definition_invalid',
    });
    await setTimeout(150);

    expect(aborted()).toEqual([false]);
  });

  it('ends the run at its bound', async () => {
    const { tools } = scriptedTools({ runBoundMs: 150 });
    const { access } = await run(callThenHang);

    expect(await failed(access, textRequest(model, { tools }))).toMatchObject({
      _tag: 'tools_stopped',
      because: 'run_bound',
      detail: 'The run went on for 150 ms, the longest a run that calls tools may take',
    });
  });
});

describe('a run whose calls end', () => {
  it('stops when its tool servers have failed too often, ending the calls in flight', async () => {
    const { tools, signals } = scriptedTools({
      endAfter: 5,
      reply: (_request, _signals, end) => {
        end();
        return Promise.resolve(foundRows);
      },
    });
    const { access } = await run(callThenAnswer);

    expect(await failed(access, textRequest(model, { tools, timeout_ms: 10_000 }))).toMatchObject({
      _tag: 'tools_stopped',
      because: 'server_failed',
    });
    expect(signals()[0]?.signal.aborted).toBe(true);
    expect(signals()[0]?.cancelled.aborted).toBe(false);
  });

  it('is cancelled, and tells the calls in flight so', async () => {
    const cancelling = new AbortController();
    const { tools, signals } = scriptedTools({
      reply: () => {
        cancelling.abort();
        return Promise.resolve(foundRows);
      },
    });
    const { access } = await run(callThenAnswer);

    expect(await failed(access, textRequest(model, { tools, signal: cancelling.signal }))).toMatchObject({
      _tag: 'cancelled',
    });
    expect(signals()[0]?.cancelled.aborted).toBe(true);
  });
});

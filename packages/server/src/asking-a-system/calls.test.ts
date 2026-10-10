import { threadReplies } from '@beonauto/mcp/testing';
import { describe, expect, it } from 'vitest';

import { chatKey } from '../testing/servers/chat-deliveries.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { askingASystem, systemRunId, threadInput, type HistoryEvent } from '../testing/servers/system-calls.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';

const aNumber: unknown = expect.any(Number);

const aTime: unknown = expect.any(String);

const record = { server: 'chat', tool: 'thread', read: '/messages' };

function keysOf(event: HistoryEvent | undefined): readonly string[] {
  return Object.keys(event?.data ?? {});
}

describe('an interaction function that asks a system, over HTTP', { timeout: workflowTestTimeoutMs }, () => {
  it('calls the tool once and answers at once with what it read, as get_run answers the run', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');

    const ran = await server.runCall('thread-replies');
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect(ran).toMatchObject({
      status: 200,
      body: {
        run_id: systemRunId,
        type: 'interaction',
        name: 'thread-replies',
        status: 'succeeded',
        output: threadReplies,
        record,
        started_at: aTime,
        finished_at: aTime,
      },
    });
    expect(read.body).toEqual(ran.body);
    expect(server.fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'com.beonauto/run_id': systemRunId },
      },
    ]);
  });
});

describe('the history of a run that asks a system', { timeout: workflowTestTimeoutMs }, () => {
  it('records the call on the run, its start under the id of the run, in the words of the history', async () => {
    const server = await askingASystem();
    await server.define('thread-replies');
    await server.runCall('thread-replies');

    const history = await server.history(systemRunId);

    expect(history.map(({ type, summary }) => [type, summary])).toEqual([
      ['run_started', 'A run of the interaction function “thread-replies” started.'],
      ['tool_call_started', 'A run made tool call 1, to the thread tool of chat.'],
      ['tool_call_answered', 'Tool call 1 answered.'],
      ['run_succeeded', 'A run finished.'],
    ]);
    expect(history[1]?.data).toMatchObject({ call_id: systemRunId, server: 'chat', tool: 'thread' });
    expect(history[2]?.data).toMatchObject({ outcome: 'result', duration_ms: aNumber });
    expect([...keysOf(history[1]), ...keysOf(history[2])]).not.toContain('arguments_json');
  });

  it('keeps the arguments and the answer, scrubbed and shown at 2 KiB, only where its server records content', async () => {
    const server = await askingASystem({ entry: { record_content: true } });
    await server.define('thread-replies');
    await server.runCall('thread-replies', { ...threadInput, channel: `${chatKey} ${'x'.repeat(5000)}` });

    const [, started, answered] = await server.history(systemRunId);

    expect(String(started?.data['arguments_json'])).toMatch(/^\{"channel":"\[redacted\] x+/u);
    expect(String(started?.data['arguments_json']).length).toBeLessThanOrEqual(2048);
    expect(String(answered?.data['result_json'])).toMatch(/^\{"content":\[\{"type":"text","text":"2 replies/u);
  });
});

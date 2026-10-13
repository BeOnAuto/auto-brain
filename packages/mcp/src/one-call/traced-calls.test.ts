import { recordingTracer, type RecordedSpan } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import { patientTiming } from '../testing/index.ts';
import { closedAfter, echoCall, oneCallKey, oneCallServer } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';

const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const toolAttributes = {
  'mcp.method.name': 'tools/call',
  'gen_ai.operation.name': 'execute_tool',
  'gen_ai.tool.name': 'echo',
  'auto.on.mcp.server': 'graph',
};

function tracedAccess(url: string): ToolAccess {
  const { access } = reportingAccess(
    { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', allowed: ['echo'] } },
    { environment: { GRAPH_API_KEY: oneCallKey }, timing: patientTiming, traceMeta: () => ({ traceparent }) },
  );
  closedAfter(access.close);
  return access;
}

async function spansOfOneCall(access: ToolAccess): Promise<readonly RecordedSpan[]> {
  const recording = recordingTracer();
  await Effect.runPromise(Effect.withTracer(access.callOnce(echoCall), recording.tracer));
  return recording.spans();
}

describe('one call of a tool, traced', () => {
  it('is a client span named for the tool, and hands the trace to the server in the metadata of the call', async () => {
    const fake = await oneCallServer();

    expect(await spansOfOneCall(tracedAccess(fake.url))).toMatchObject([
      { name: 'tools/call echo', kind: 'client', ending: 'succeeded', attributes: toolAttributes },
    ]);
    expect(fake.received()).toEqual([
      { tool: 'echo', arguments: echoCall.input, meta: { traceparent, ...echoCall.meta } },
    ]);
  });

  it('names why a call that was never sent ended, and how a sent call that did not answer ended', async () => {
    const fake = await oneCallServer();
    fake.answerNextOf('tools/call', 503);
    const failed = await spansOfOneCall(tracedAccess(fake.url));
    const { url } = fake;
    await fake.close();
    const unopened = await spansOfOneCall(tracedAccess(url));

    expect([...failed, ...unopened].map(({ attributes }) => attributes)).toEqual([
      { ...toolAttributes, 'error.type': 'server_failure' },
      { ...toolAttributes, 'error.type': 'mcp_server_failed', 'auto.on.mcp.because': 'unreachable' },
    ]);
  });
});

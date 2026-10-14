import { createHash } from 'node:crypto';

import { keptTextOf } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { controlledSignals, recordingCallJournal, toolRun } from '../testing/tool-runs.ts';
import { behaviourKey, type ServedUnderTest, type ServerUnderTest } from './servers-under-test.ts';

type Facts = ReturnType<ReturnType<typeof recordingCallJournal>['facts']>;

const alpha = { org: 'acme', playbook: 'alpha' };

const timing = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const aNumber: unknown = expect.any(Number);

const aRequestId: unknown = expect.stringMatching(/^request-\d+$/u);

const theServerNamed: unknown = expect.stringContaining('graph');

const theDenial: unknown = expect.stringContaining('salary is denied');

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

async function served(underTest: ServerUnderTest, requestIdHeader?: string): Promise<ServedUnderTest> {
  const fake = await underTest.serve(requestIdHeader);
  onTestFinished(fake.close);
  return fake;
}

function resultDigestOf(facts: Facts): string {
  return facts
    .flatMap((fact) => (fact.type === 'tool_call_answered' ? [String(fact.data.result_sha256)] : []))
    .join('');
}

function digestFieldsOf(facts: Facts): readonly (readonly string[])[] {
  return facts.map(({ data }) => Object.keys(data).filter((key) => key.endsWith('_sha256')));
}

async function calledThrough(
  fake: ServedUnderTest,
  tool: string,
  input: Readonly<Record<string, unknown>>,
  entry = {},
) {
  const { access, content } = await describedAccess(
    { graph: { ...fake.entry, ...entry } },
    { environment: { GRAPH_API_KEY: behaviourKey }, timing },
  );
  onTestFinished(access.close);
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'graph', tool }]));
  onTestFinished(tools.close);
  const [offered] = tools.offered;
  const reply = await offered?.call({ callId: 'call-1', input }, controlledSignals());
  return { reply, facts: journal.facts(), kept: (sha256: string) => keptTextOf(content, alpha, sha256) };
}

function keptAndScrubbed(underTest: ServerUnderTest): void {
  it('records the start and the answer of a call with their sizes and digests, and keeps both whole, scrubbed of its secrets', async () => {
    const fake = await served(underTest);
    const input = fake.echoed({ note: `the key is ${behaviourKey}` });
    const scrubbed = JSON.stringify(input).replace(behaviourKey, '[redacted]');
    const started = { call_id: 'call-1', server: 'graph', tool: 'echo', arguments_bytes: Buffer.byteLength(scrubbed) };

    const { facts, kept } = await calledThrough(fake, 'echo', input);

    expect(facts[0]).toEqual({
      number: 1,
      type: 'tool_call_started',
      data: { ...started, arguments_sha256: digest(scrubbed) },
    });
    expect(facts[1]).toMatchObject({
      type: 'tool_call_answered',
      data: { is_error: false, result_bytes: aNumber, duration_ms: aNumber, jsonrpc_id: fake.jsonrpcId },
    });
    expect(await kept(resultDigestOf(facts))).toContain('[redacted]');
    expect(await kept(resultDigestOf(facts))).not.toContain(behaviourKey);
    expect(await kept(digest(scrubbed))).toBe(scrubbed);
  });
}

function sizesAlone(underTest: ServerUnderTest): void {
  it('records the sizes alone of the calls of an entry that keeps no content', async () => {
    const fake = await served(underTest);

    const { facts } = await calledThrough(fake, 'search', { query: 'acme' }, { record_content: false });

    expect(digestFieldsOf(facts)).toEqual([[], []]);
    expect(facts[0]).toMatchObject({ data: { tool: 'search', arguments_bytes: 16, read_only: true } });
  });
}

function requestIds(underTest: ServerUnderTest): void {
  it("records the server's own id of the request in the header its entry names", async () => {
    const fake = await served(underTest, 'x-request-id');

    const { facts } = await calledThrough(fake, 'search', { query: 'acme' }, { request_id: 'x-request-id' });

    expect(facts[1]).toMatchObject({ data: { server_request_id: aRequestId } });
  });
}

function denials(underTest: ServerUnderTest): void {
  it('answers what the tool denied as a tool error, in its own words', async () => {
    const fake = await served(underTest);

    const { reply, facts } = await calledThrough(fake, 'denied', {});

    expect(reply).toMatchObject({ isError: true, outcome: 'tool_error', text: theDenial });
    expect(facts[1]).toMatchObject({ type: 'tool_call_answered', data: { is_error: true } });
  });
}

function serverFailures(underTest: ServerUnderTest): void {
  it('fails a call its server answers with HTTP 500 as a server failure, naming the server to the model', async () => {
    const fake = await served(underTest);
    fake.failNextCall(500);

    const { reply, facts } = await calledThrough(fake, 'search', { query: 'acme' });

    expect(reply).toMatchObject({ isError: true, outcome: 'server_failure', text: theServerNamed });
    expect(facts[1]).toMatchObject({
      type: 'tool_call_failed',
      data: { because: 'server_failure', detail: 'The tool server answered HTTP 500', jsonrpc_id: fake.jsonrpcId },
    });
  });

  it('waits out a 429 whose Retry-After fits the longest wait, and answers', async () => {
    const fake = await served(underTest);
    fake.failNextCall(429, { 'retry-after': '0' });

    const { reply } = await calledThrough(fake, 'search', { query: 'acme' });

    expect(reply).toMatchObject({ isError: false, outcome: 'result', text: 'Found 2 rows for acme.' });
    expect(fake.calls()).toBe(2);
  });
}

function argumentBounds(underTest: ServerUnderTest): void {
  it('refuses arguments larger than a call may send, sending and recording nothing', async () => {
    const fake = await served(underTest);
    const input = fake.echoed({ note: 'x'.repeat(toolBounds.argumentBytes) });

    const { reply, facts } = await calledThrough(fake, 'echo', input);

    expect(reply).toMatchObject({ isError: true, outcome: 'not_sent' });
    expect(facts).toEqual([]);
    expect(fake.calls()).toBe(0);
  });
}

export function toolAccessBehaviour(underTest: ServerUnderTest): void {
  describe(`the tools of ${underTest.kind}, reached through the tool access`, () => {
    keptAndScrubbed(underTest);
    sizesAlone(underTest);
    requestIds(underTest);
    denials(underTest);
    serverFailures(underTest);
    argumentBounds(underTest);
  });
}

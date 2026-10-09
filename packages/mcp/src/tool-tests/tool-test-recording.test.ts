import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeApiKey, patientTiming, reportingAccess, serveFakeMcp, toolTests } from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeTested = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ test_id: Schema.String }) }));

const aTime: unknown = expect.any(String);

const aNumber: unknown = expect.any(Number);

const withinTheStoredBound: unknown = expect.toSatisfy(
  (stored: string) => Buffer.byteLength(JSON.stringify(stored)) - 2 <= 4096,
);

const scrubbedArguments: unknown = expect.stringMatching(/^\{"said":"the key is \[redacted\] /u);

const scrubbedResult: unknown = expect.stringMatching(/^\{"content":\[\{"type":"text","text":".*\[redacted\]/u);

async function testsOn(entry: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
  const { access } = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  return { fake, ...toolTests(access) };
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('what a test records', () => {
  it('is two events on a stream of its own, the answer caused by the start, without content by default', async () => {
    const { test, recorded } = await testsOn();
    const argumentsJson = JSON.stringify({ query: 'acme' });

    const testId = decodeTested(await test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).output
      .test_id;
    const [started, answered] = await recorded();
    const answeredData: unknown = expect.objectContaining({
      type: 'tool_test_answered',
      test_id: testId,
      outcome: 'result',
      jsonrpc_id: aNumber,
    });

    expect([started, answered]).toEqual([
      expect.objectContaining({
        stream: `brain/acme/alpha/tool-tests/${testId}`,
        type: 'tool_test_started',
        causationId: null,
        correlationId: null,
        data: {
          type: 'tool_test_started',
          test_id: testId,
          server: 'graph',
          tool: 'search',
          arguments_bytes: Buffer.byteLength(argumentsJson),
          arguments_sha256: digestOf(argumentsJson),
          by: 'acme-builder',
          at: aTime,
        },
      }),
      expect.objectContaining({
        stream: `brain/acme/alpha/tool-tests/${testId}`,
        type: 'tool_test_answered',
        causationId: started?.id,
        data: answeredData,
      }),
    ]);
  });
});

describe('the content a test records', () => {
  it('is held only where the entry records content, scrubbed and cut to 4 KiB as stored', async () => {
    const { test, recorded } = await testsOn({ record_content: true, testable: ['echo'] });

    await test({ server: 'graph', tool: 'echo', arguments: { said: `the key is ${fakeApiKey} ${'x'.repeat(6000)}` } });
    const records = await recorded();

    expect(records).toMatchObject([
      { data: { arguments_json: scrubbedArguments } },
      { data: { result_json: scrubbedResult } },
    ]);
    expect(records.map(({ data }) => data)).toEqual([
      expect.objectContaining({ arguments_json: withinTheStoredBound }),
      expect.objectContaining({ result_json: withinTheStoredBound }),
    ]);
    expect(JSON.stringify(records)).not.toContain(fakeApiKey);
  });
});

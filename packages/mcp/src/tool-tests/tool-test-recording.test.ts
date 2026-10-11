import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { keptTextOf } from '@beonauto/operations/testing';
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

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const alpha = { org: 'acme', brain: 'alpha' };

async function testsOn(entry: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
  const { access, content } = reportingAccess(
    { graph },
    { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const kept = (sha256: string) => keptTextOf(content, alpha, sha256);
  return { fake, kept, ...toolTests(access) };
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('what a test records', () => {
  it('is two facts on a stream of its own, the answer caused by the start, with who tested in its context', async () => {
    const { test, recorded } = await testsOn();
    const argumentsJson = JSON.stringify({ query: 'acme' });

    const testId = decodeTested(await test({ server: 'graph', tool: 'search', arguments: { query: 'acme' } })).output
      .test_id;
    const [started, answered] = await recorded();
    const answeredData: unknown = expect.objectContaining({ test_id: testId, is_error: false, jsonrpc_id: aNumber });

    expect([started, answered]).toEqual([
      expect.objectContaining({
        stream: `brain/acme/alpha/tool-tests/${testId}`,
        type: 'tool_test_started',
        causationId: null,
        correlationId: null,
        data: {
          test_id: testId,
          server: 'graph',
          tool: 'search',
          arguments_bytes: Buffer.byteLength(argumentsJson),
          arguments_sha256: digestOf(argumentsJson),
          read_only: true,
        },
        context: { by: 'acme-builder', at: aTime },
      }),
      expect.objectContaining({
        stream: `brain/acme/alpha/tool-tests/${testId}`,
        type: 'tool_test_answered',
        causationId: started?.id,
        data: answeredData,
        context: { by: 'acme-builder', at: aTime },
      }),
    ]);
  });
});

describe('the content a test records', () => {
  it('is kept whole and scrubbed by default, and not at all where the entry turns keeping off', async () => {
    const said = { said: `the key is ${fakeApiKey} ${'x'.repeat(6000)}` };
    const scrubbed = JSON.stringify({ said: `the key is [redacted] ${'x'.repeat(6000)}` });
    const keeping = await testsOn({ testable: ['echo'] });
    const notKeeping = await testsOn({ testable: ['echo'], record_content: false });

    await keeping.test({ server: 'graph', tool: 'echo', arguments: said });
    await notKeeping.test({ server: 'graph', tool: 'echo', arguments: said });
    const [kept, unkept] = [await keeping.recorded(), await notKeeping.recorded()];
    const resultSha256 = String(Reflect.get(new Object(kept[1]?.data), 'result_sha256'));
    const keptResult = String(await keeping.kept(resultSha256));

    await expect(keeping.kept(digestOf(scrubbed))).resolves.toBe(scrubbed);
    await expect(notKeeping.kept(digestOf(scrubbed))).resolves.toBeUndefined();
    expect([kept.map(({ data }) => data), unkept.map(({ data }) => data)]).toEqual([
      [
        expect.objectContaining({ arguments_bytes: Buffer.byteLength(scrubbed), arguments_sha256: digestOf(scrubbed) }),
        expect.objectContaining({ result_sha256: aDigest }),
      ],
      [
        expect.not.objectContaining({ arguments_sha256: aDigest }),
        expect.not.objectContaining({ result_sha256: aDigest }),
      ],
    ]);
    expect(unkept[0]?.data).toMatchObject({ arguments_bytes: Buffer.byteLength(scrubbed) });
    expect(digestOf(keptResult)).toBe(resultSha256);
    expect(keptResult).toContain('the key is [redacted]');
    expect(JSON.stringify([...kept, ...unkept, keptResult])).not.toContain(fakeApiKey);
  });
});

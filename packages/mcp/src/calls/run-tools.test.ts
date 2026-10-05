import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it } from 'vitest';

import { fakeApiKey, openFakeToolRun, verboseDescription } from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function runWith(tools: readonly string[]) {
  const run = await openFakeToolRun(tools);
  closing.push(run.close);
  return run;
}

describe('what the model sees of a tool', () => {
  it('sees its description cut to 4 KiB', async () => {
    const { tools, call } = await runWith(['verbose']);
    const [verbose] = tools.offered;
    const description = String(verbose?.description);

    expect(await call('verbose', {})).toEqual({ text: 'Said.', isError: false });
    expect(Buffer.byteLength(verboseDescription)).toBeGreaterThan(4096);
    expect(Buffer.byteLength(description)).toBe(4096);
    expect(verboseDescription.startsWith(description)).toBe(true);
  });

  it('sees its results scrubbed of the secrets of its server', async () => {
    const { call } = await runWith(['echo']);

    expect(await call('echo', { said: `the key is ${fakeApiKey}` })).toEqual({
      text: '{"said":"the key is [redacted]"}',
      isError: false,
    });
  });
});

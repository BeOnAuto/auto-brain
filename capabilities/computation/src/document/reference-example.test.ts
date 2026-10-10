import { readFileSync } from 'node:fs';

import { Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import { computationWith, workerTestTimeoutMs } from '../testing/computation-runs.ts';

const referencePage = readFileSync(
  new URL('../../../../docs/reference/computation-format.md', import.meta.url),
  'utf8',
);

const fencedBlocks = [...referencePage.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

describe('the example on the reference page of computation functions', { timeout: workerTestTimeoutMs }, () => {
  it('is, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${campaignPace}\n`);
  });

  it('answers the input the page gives with the output the page shows, spending the work it says', async () => {
    const [, input, output] = fencedBlocks;

    expect([input?.language, output?.language]).toEqual(['json', 'json']);
    expect(referencePage).toContain('spent 0 checkpoints of work');
    expect(await computationWith().running(campaignPace, decodeJson(input?.body))).toMatchObject(
      Exit.succeed({ output: decodeJson(output?.body), record: { work: 0 } }),
    );
  });
});

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryRecordedContent } from './memory-content.ts';

const alpha = { org: 'acme', brain: 'alpha' };

const beta = { org: 'acme', brain: 'beta' };

describe('the content a brain recorded', () => {
  it('keeps a digest once, as it was first put, and reads it back in its brain alone', async () => {
    const content = memoryRecordedContent();

    const read = await Effect.runPromise(
      Effect.gen(function* () {
        yield* content.put(alpha, 'digest', '{"rows":[1]}');
        yield* content.put(alpha, 'digest', '{"rows":[2]}');
        return yield* Effect.all([
          content.get(alpha, 'digest'),
          content.get(beta, 'digest'),
          content.get(alpha, 'another digest'),
        ]);
      }),
    );

    expect(read).toEqual(['{"rows":[1]}', undefined, undefined]);
  });
});

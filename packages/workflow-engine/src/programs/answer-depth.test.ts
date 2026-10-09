import { describe, expect, it } from 'vitest';

import { tooDeepIn } from './answer-depth.ts';

function nested(levels: number, inner: unknown = 0): unknown {
  return Array.from({ length: levels }).reduce<unknown>((value) => [value], inner);
}

describe('the depth of an answer, read by the host', () => {
  it('is not read in an answer too short to nest deeper than 512 levels', () => {
    expect(tooDeepIn(JSON.stringify(nested(512)))).toBeUndefined();
  });

  it('counts the brackets outside text alone, an escaped quote keeping the text open', () => {
    const inText = JSON.stringify({ note: `${'['.repeat(600)}"${'{'.repeat(600)}`, list: nested(3) });

    expect(tooDeepIn(inText)).toBeUndefined();
  });

  it('lets a value of 512 levels pass however long it is', () => {
    expect(tooDeepIn(JSON.stringify(['x'.repeat(2000), nested(511)]))).toBeUndefined();
  });

  it('names the first member deeper than 512 levels, by its key or its index', () => {
    const answer = { shallow: { kept: 1 }, 'a key': [{ x: nested(600) }] };

    expect(tooDeepIn(JSON.stringify(answer))).toBe(`$["a key"][0].x${'[0]'.repeat(509)}`);
  });
});

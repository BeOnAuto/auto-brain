import { describe, expect, it } from 'vitest';

import { bytesOfText, chunksOf, mostContentChunkBytes, sha256Of } from './content-chunks.ts';

const text = Array.from({ length: 4000 }, (_, index) => `${index} é ✓ 𝄞 ${'x'.repeat(index % 17)}`).join(',');

describe('the chunks of a recorded content', () => {
  it('hold at most the bytes they are given, each cut at a code point, and join back exactly', () => {
    const chunks = chunksOf(text, 1000);

    expect(chunks.join('')).toBe(text);
    expect(Math.max(...chunks.map((chunk) => bytesOfText(chunk)))).toBeLessThanOrEqual(1000);
    expect(chunks.every((chunk) => chunk.isWellFormed())).toBe(true);
    expect(chunks.length).toBeGreaterThan(bytesOfText(text) / 1000);
  });

  it('are 1 MiB at most when no bound is given, and none for no text', () => {
    const large = 'é'.repeat(mostContentChunkBytes);

    expect(chunksOf(large).map((chunk) => bytesOfText(chunk))).toEqual([mostContentChunkBytes, mostContentChunkBytes]);
    expect(chunksOf('')).toEqual([]);
  });

  it('refuse a bound that cannot hold one code point', () => {
    expect(() => chunksOf(text, 3)).toThrow('A chunk holds at least the 4 bytes of one code point');
  });
});

describe('the digest of a recorded content', () => {
  it('is the SHA-256 of its text in UTF-8, in lowercase hex', async () => {
    expect(await Promise.all([sha256Of(''), sha256Of('é')])).toEqual([
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    ]);
  });
});

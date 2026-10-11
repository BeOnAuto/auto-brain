import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Digest } from './sha256-digest.ts';

function digestInParts(bytes: Readonly<Uint8Array>, parts: readonly number[]): string {
  const digest = sha256Digest();
  let offset = 0;
  for (const part of parts) {
    digest.update(bytes.subarray(offset, offset + part));
    offset += part;
  }
  digest.update(bytes.subarray(offset));
  return digest.hex();
}

describe('the SHA-256 of bytes given in parts', () => {
  it.each([0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 65_537])(
    'is the SHA-256 of %i bytes, however they are split',
    (length) => {
      const bytes = randomBytes(length);
      const expected = createHash('sha256').update(bytes).digest('hex');

      expect([
        digestInParts(bytes, []),
        digestInParts(bytes, [1, 0, 2]),
        digestInParts(bytes, [63, 1]),
        digestInParts(bytes, [70, 64, 7]),
        digestInParts(
          bytes.subarray(0),
          Array.from({ length }, () => 1),
        ),
      ]).toEqual([expected, expected, expected, expected, expected]);
    },
  );

  it('is the known digest of the empty input and of "abc"', () => {
    const empty = sha256Digest();
    const abc = sha256Digest();
    abc.update(new TextEncoder().encode('abc'));

    expect([empty.hex(), abc.hex()]).toEqual([
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ]);
  });
});

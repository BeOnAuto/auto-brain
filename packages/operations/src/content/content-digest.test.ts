import { describe, expect, it } from 'vitest';

import { sha256Digest, sha256Of } from './content-digest.ts';

describe('the SHA-256 of a content', () => {
  it('is the known digest of no bytes, of "abc", and of a text as of its UTF-8, in lowercase hex', () => {
    expect([sha256Of(''), sha256Of('abc'), sha256Of('é'), sha256Of(Uint8Array.of(0xc3, 0xa9))]).toEqual([
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    ]);
  });

  it('is the same digested in parts as whole', () => {
    const digest = sha256Digest();
    digest.update('a');
    digest.update(Uint8Array.of(0x62));
    digest.update('c');

    expect(digest.hex()).toBe(sha256Of('abc'));
  });
});

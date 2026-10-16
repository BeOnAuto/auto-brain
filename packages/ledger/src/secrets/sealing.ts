import { Redacted } from 'effect';
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader, type DecryptOptions } from 'jose';

import type { SealingKey } from './secret-keys.ts';

const keyWrapping = 'A256KW';

const contentEncryption = 'A256GCM';

const unsealingOptions: DecryptOptions = {
  keyManagementAlgorithms: [keyWrapping],
  contentEncryptionAlgorithms: [contentEncryption],
  maxDecompressedLength: 0,
};

export function sealedUnder({ kid, bytes }: SealingKey, value: string): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(value))
    .setProtectedHeader({ alg: keyWrapping, enc: contentEncryption, kid })
    .encrypt(Redacted.value(bytes));
}

export function kidOfSealed(sealed: string): string {
  return String(decodeProtectedHeader(sealed).kid);
}

export async function unsealedWith({ bytes }: SealingKey, sealed: string): Promise<string> {
  const { plaintext } = await compactDecrypt(sealed, Redacted.value(bytes), unsealingOptions);
  return new TextDecoder().decode(plaintext);
}

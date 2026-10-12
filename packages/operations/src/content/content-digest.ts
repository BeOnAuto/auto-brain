import { createHash } from 'node:crypto';

export interface Sha256Digest {
  readonly update: (content: string | Readonly<Uint8Array>) => void;
  readonly hex: () => string;
}

export function sha256Digest(): Sha256Digest {
  const hash = createHash('sha256');
  return {
    update: (content) => {
      hash.update(content);
    },
    hex: () => hash.digest('hex'),
  };
}

export function sha256Of(content: string | Readonly<Uint8Array>): string {
  const digest = sha256Digest();
  digest.update(content);
  return digest.hex();
}

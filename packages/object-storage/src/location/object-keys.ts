import { streamPrefixOfBrain, type BrainAddress } from '@beonauto/operations';

import type { ContentLocation } from './content-location.ts';

export interface ObjectKeys {
  readonly kept: (brain: BrainAddress, sha256: string) => string;
  readonly uploads: string;
  readonly upload: (uploadId: string) => string;
  readonly run: (brain: BrainAddress, run: string) => string;
  readonly staged: (brain: BrainAddress, run: string, sha256: string) => string;
  readonly ended: (brain: BrainAddress, run: string) => string;
}

const endedMarker = '.ended';

export function objectKeysOf({ prefix }: ContentLocation): ObjectKeys {
  const under = (key: string) => (prefix === '' ? key : `${prefix}/${key}`);
  const run = (brain: BrainAddress, id: string) =>
    under(`staging/${streamPrefixOfBrain(brain)}${encodeURIComponent(id)}/`);
  return {
    kept: (brain, sha256) => under(`${streamPrefixOfBrain(brain)}${sha256}`),
    uploads: under('uploads/'),
    upload: (uploadId) => under(`uploads/${uploadId}`),
    run,
    staged: (brain, id, sha256) => `${run(brain, id)}${sha256}`,
    ended: (brain, id) => `${run(brain, id)}${endedMarker}`,
  };
}

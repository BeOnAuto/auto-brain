import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { release } from './release.ts';

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })),
);

describe('release', () => {
  it('names the product and carries the release version of the repository manifest', () => {
    const manifest = manifestOf(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));

    expect(release).toEqual({ name: 'auto-brain', version: manifest.version });
    expect(manifest.name).toBe('auto-brain');
  });
});

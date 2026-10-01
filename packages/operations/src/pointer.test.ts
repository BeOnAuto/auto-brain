import type { StandardSchema } from 'effect';
import { describe, expect, it } from 'vitest';

import { pointerOf } from './pointer.ts';

const cases: ReadonlyArray<readonly [StandardSchema.StandardSchemaV1.Issue['path'], string]> = [
  [undefined, ''],
  [[], ''],
  [['name'], '/name'],
  [['items', 0, { key: 'a/b' }, { key: 'c~d' }], '/items/0/a~1b/c~0d'],
];

describe('pointerOf', () => {
  it.each(cases)('turns the issue path %j into the JSON Pointer "%s"', (path, pointer) => {
    expect(pointerOf(path)).toBe(pointer);
  });
});

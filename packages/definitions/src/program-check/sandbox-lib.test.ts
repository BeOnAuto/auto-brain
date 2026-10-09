import { sandboxAnswers } from '@beonauto/workflow-engine/dsl';
import { describe, expect, it } from 'vitest';

import { keptLibFiles, keptSandboxLib } from './kept-lib.ts';
import { sandboxLibOf } from './sandbox-lib.ts';

const kept = keptSandboxLib();

function declares(text: string): (fragment: string) => boolean {
  return (fragment) => text.includes(fragment);
}

describe('the lib of the sandbox', () => {
  it('is what the generator makes from the compiler’s libs and the sandbox’s own answers, kept beside the package', async () => {
    expect(await sandboxLibOf(sandboxAnswers)).toEqual(kept);
    expect(keptLibFiles.script.pathname).toMatch(/\/definitions\/lib\/sandbox\.d\.ts\.txt$/u);
    expect(keptLibFiles.iterator.pathname).toMatch(/\/definitions\/lib\/sandbox-iterator\.d\.ts\.txt$/u);
  });

  it('declares nothing the prelude removes or the engine lacks, and what the engine has', () => {
    const has = declares(kept.script);

    expect(
      [
        'random(): number;',
        'declare function eval(',
        'declare var Function:',
        'declare var WeakRef:',
        'declare var FinalizationRegistry:',
        'getHours(): number;',
        'getTimezoneOffset(): number;',
        'toLocaleDateString(',
        'declare var Atomics:',
        '"$1": string;',
        'declare namespace Intl',
      ].filter((fragment) => has(fragment)),
    ).toEqual(['declare namespace Intl']);
    expect(
      [
        'toSorted(compareFn?:',
        'groupBy<K extends PropertyKey, T>(',
        'union<U>(other: ReadonlySetLike<U>): Set<T | U>;',
        'readonly description: string | undefined;',
        'cause?: unknown;',
        'declare var SharedArrayBuffer:',
        'getUTCHours(): number;',
      ].every((fragment) => has(fragment)),
    ).toBe(true);
    expect(kept.iterator).toContain('toArray(): T[];');
  });

  it('keeps the compiler’s notice once at the top of each file', () => {
    expect([kept.script, kept.iterator].map((text) => text.match(/Copyright \(c\) Microsoft/gu)?.length)).toEqual([
      1, 1,
    ]);
    expect(kept.script.startsWith('/*!')).toBe(true);
  });
});

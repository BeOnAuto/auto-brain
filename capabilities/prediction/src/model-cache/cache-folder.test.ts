import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scratchDirectory } from '../testing/scratch.ts';
import { cacheFolderProblem } from './cache-folder.ts';

function folderWithMode(mode: number): string {
  const folder = join(scratchDirectory(), 'cache');
  mkdirSync(folder);
  chmodSync(folder, mode);
  return folder;
}

describe('the folder the model processes keep their files in', () => {
  it('is taken when it is not there yet, or when its owner alone may write to it', async () => {
    expect([
      await cacheFolderProblem(join(scratchDirectory(), 'not-yet')),
      await cacheFolderProblem(folderWithMode(0o700)),
      await cacheFolderProblem(folderWithMode(0o755)),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it('is refused when it is a file, when another user owns it, or when others may write to it', async () => {
    const file = join(scratchDirectory(), 'a-file');
    writeFileSync(file, '');
    const owned = folderWithMode(0o700);

    expect([
      await cacheFolderProblem(file),
      await cacheFolderProblem(owned, statSync(owned).uid + 1),
      await cacheFolderProblem(folderWithMode(0o770)),
      await cacheFolderProblem(folderWithMode(0o707)),
    ]).toEqual([
      'is not a folder',
      'belongs to another user',
      'may be written by users other than its owner',
      'may be written by users other than its owner',
    ]);
  });
});

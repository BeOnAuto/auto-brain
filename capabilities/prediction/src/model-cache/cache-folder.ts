import type { Stats } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

import { folderMode } from './cached-files.ts';

const writableByOthers = 0o022;

function problemOf(found: Readonly<Stats>, owner: number | undefined): string | undefined {
  if (!found.isDirectory()) {
    return 'is not a folder';
  }
  if (owner !== undefined && found.uid !== owner) {
    return 'belongs to another user';
  }
  return (found.mode & writableByOthers) === 0 ? undefined : 'may be written by users other than its owner';
}

export async function cacheFolderProblem(directory: string, owner = process.getuid?.()): Promise<string | undefined> {
  await mkdir(directory, { recursive: true, mode: folderMode }).catch(() => null);
  const found = await stat(directory).catch(() => null);
  return found === null ? 'could not be made' : problemOf(found, owner);
}

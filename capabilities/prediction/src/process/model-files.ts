import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { notTheBytesOfItsDigest, type StreamedContent } from '@on.auto/operations';
import { Effect } from 'effect';

export interface CachedFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly path: string;
}

export type ContentSource = () => Effect.Effect<StreamedContent | undefined>;

export interface FileCache {
  readonly pathOf: (sha256: string, source: ContentSource) => Effect.Effect<string | undefined>;
  readonly received: (stream: ReadableStream<Uint8Array>) => Effect.Effect<CachedFile>;
}

export interface FileCacheSettings {
  readonly directory: string;
  readonly extension: string;
  readonly mostBytes: number;
}

export const mostCachedBytes = 1_073_741_824;

const cachedName = /^[0-9a-f]{64}\./u;

async function written(stream: ReadableStream<Uint8Array>, path: string): Promise<Omit<CachedFile, 'path'>> {
  const hash = createHash('sha256');
  const counted = { bytes: 0 };
  const file = await open(path, 'w');
  try {
    await stream.pipeTo(
      new WritableStream<Uint8Array>({
        write: async (chunk: Readonly<Uint8Array>) => {
          hash.update(chunk);
          counted.bytes += chunk.byteLength;
          await file.write(chunk);
        },
      }),
    );
  } finally {
    await file.close();
  }
  return { sha256: hash.digest('hex'), bytes: counted.bytes };
}

interface Shelved {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedMs: number;
}

async function shelvedIn(directory: string): Promise<readonly Shelved[]> {
  await mkdir(directory, { recursive: true });
  const names = (await readdir(directory)).filter((name) => cachedName.test(name));
  const found = await Promise.all(
    names.map(async (name): Promise<Shelved> => {
      const path = join(directory, name);
      const { size, mtimeMs } = await stat(path);
      return { path, bytes: size, modifiedMs: mtimeMs };
    }),
  );
  return found.toSorted((one, other) => one.modifiedMs - other.modifiedMs);
}

function evictedOf(used: ReadonlyMap<string, number>, mostBytes: number, keep: string): readonly string[] {
  let left = [...used.values()].reduce((sum, bytes) => sum + bytes, 0);
  const gone: string[] = [];
  for (const [path, bytes] of used) {
    if (left > mostBytes && path !== keep) {
      gone.push(path);
      left -= bytes;
    }
  }
  return gone;
}

async function present(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

interface Shelf {
  readonly ready: () => Promise<void>;
  readonly used: () => ReadonlyMap<string, number>;
  readonly touched: (path: string, bytes: number) => void;
  readonly gone: (paths: readonly string[]) => Promise<unknown>;
}

function shelfIn(directory: string): Shelf {
  const used = new Map<string, number>();
  const opening: { ready?: Promise<void> } = {};
  const touched = (path: string, bytes: number) => {
    used.delete(path);
    used.set(path, bytes);
  };
  const filled = async () => {
    for (const { path, bytes } of await shelvedIn(directory)) {
      touched(path, bytes);
    }
  };
  return {
    ready: () => (opening.ready ??= filled()),
    used: () => used,
    touched,
    gone: (paths) => {
      for (const path of paths) {
        used.delete(path);
      }
      return Promise.all(paths.map((path) => rm(path, { force: true })));
    },
  };
}

export function fileCache({ directory, extension, mostBytes }: FileCacheSettings): FileCache {
  const shelf = shelfIn(directory);
  const { ready } = shelf;
  const kept = async (file: Omit<CachedFile, 'path'>, from: string): Promise<CachedFile> => {
    const path = join(directory, `${file.sha256}.${extension}`);
    await rename(from, path);
    shelf.touched(path, file.bytes);
    await shelf.gone(evictedOf(shelf.used(), mostBytes, path));
    return { ...file, path };
  };
  const receivedInto = async (stream: ReadableStream<Uint8Array>): Promise<CachedFile> => {
    await ready();
    await mkdir(directory, { recursive: true });
    const partial = join(directory, `.${randomUUID()}.part`);
    try {
      return await kept(await written(stream, partial), partial);
    } finally {
      await rm(partial, { force: true });
    }
  };
  const fetched = async (sha256: string, content: StreamedContent): Promise<string> => {
    const file = await receivedInto(content.stream);
    if (file.sha256 !== sha256) {
      await shelf.gone([file.path]);
      throw notTheBytesOfItsDigest(sha256);
    }
    return file.path;
  };
  return {
    received: (stream) => Effect.promise(() => receivedInto(stream)),
    pathOf: (sha256, source) =>
      Effect.gen(function* () {
        yield* Effect.promise(ready);
        const path = join(directory, `${sha256}.${extension}`);
        const bytes = shelf.used().get(path);
        if (bytes !== undefined && (yield* Effect.promise(() => present(path)))) {
          shelf.touched(path, bytes);
          return path;
        }
        const content = yield* source();
        return content === undefined ? undefined : yield* Effect.promise(() => fetched(sha256, content));
      }),
  };
}

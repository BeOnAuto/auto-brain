import { sha256Of, textOfContent, textToKeep, type PlaybookAddress, type ContentToKeep } from '@beonauto/operations';
import { Effect } from 'effect';

import { answerOfAbout, generatedStream, octets, readThrough } from '../src/content/content-samples.ts';
import type { LedgerStore } from '../src/event-store.ts';
import { modestConnections } from '../src/sqlite3.ts';
import { inTurn, measuredOnEachStore, timed, write, type MeasuredStore } from './stores.ts';

const sizes: readonly (readonly [string, number])[] = [
  ['100 B', 100],
  ['64 KiB', 65_536],
  ['1 MB', 1_000_000],
  ['5 MB', 5_000_000],
  ['20 MB', 20_000_000],
];

const playbook = { org: 'acme', playbook: 'alpha' };

const mebibyte = 1_048_576;

const streamedBytes = 64 * mebibyte;

const sampleSeed = 7;

interface Held {
  readonly heap: number;
  readonly resident: number;
}

function milliseconds(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 1)} ms`;
}

function heldNow(): Held {
  globalThis.gc?.();
  const { heapUsed, arrayBuffers, rss } = process.memoryUsage();
  return { heap: heapUsed + arrayBuffers, resident: rss };
}

async function mostHeldDuring(work: () => Promise<unknown>): Promise<Held> {
  const before = heldNow();
  let most = before;
  const sampling = setInterval(() => {
    const now = heldNow();
    most = { heap: Math.max(most.heap, now.heap), resident: Math.max(most.resident, now.resident) };
  }, 5);
  try {
    await work();
  } finally {
    clearInterval(sampling);
  }
  return { heap: most.heap - before.heap, resident: most.resident - before.resident };
}

async function piecesOf(stream: ReadableStream<Uint8Array>): Promise<readonly Readonly<Uint8Array>[]> {
  const pieces: Readonly<Uint8Array>[] = [];
  for await (const piece of stream) {
    pieces.push(piece);
  }
  return pieces;
}

function streamOf(pieces: readonly Readonly<Uint8Array>[]): ContentToKeep {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const piece = pieces[next];
      next += 1;
      if (piece === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(piece);
    },
  });
  return { stream, mediaType: octets };
}

function put(store: LedgerStore, into: PlaybookAddress, content: ContentToKeep): Promise<unknown> {
  return Effect.runPromise(store.content.put(into, content));
}

async function measuredText(store: LedgerStore, name: string): Promise<void> {
  await inTurn(sizes, async ([label, bytes]) => {
    const text = answerOfAbout(bytes);
    const sha256 = sha256Of(text);
    const [first, second, expected] = [
      textToKeep(text, 'application/json'),
      textToKeep(text, 'application/json'),
      { ...textToKeep(text, 'application/json'), expected: { sha256 } },
    ];
    const kept = await timed(() => put(store, playbook, first));
    const again = await timed(() => put(store, playbook, second));
    const givenItsDigest = await timed(() => put(store, playbook, expected));
    let read = '';
    const got = await timed(async () => {
      const content = await Effect.runPromise(store.content.get(playbook, sha256));
      read = content === undefined ? '' : await Effect.runPromise(textOfContent(content));
      JSON.parse(read);
    });
    write(
      `| ${name} | ${label} | ${milliseconds(kept)} | ${milliseconds(again)} | ${milliseconds(givenItsDigest)} | ${milliseconds(got)} | ${String(read === text)} |`,
    );
  });
}

async function readBack(store: LedgerStore, from: PlaybookAddress, sha256: string) {
  const content = await Effect.runPromise(store.content.get(from, sha256));
  return content === undefined ? undefined : readThrough(content.stream);
}

function mebibytes(bytes: number): string {
  return `${(bytes / mebibyte).toFixed(1)} MiB`;
}

async function heldWhileStreamed(store: LedgerStore, name: string, sha256: string): Promise<string> {
  const elsewhere = { org: 'acme', playbook: 'beta' };
  const putting = await mostHeldDuring(() =>
    put(store, elsewhere, { stream: generatedStream(streamedBytes, sampleSeed), mediaType: octets }),
  );
  const getting = await mostHeldDuring(() => readBack(store, elsewhere, sha256));
  return `${name}: while putting 64 MiB, at most ${mebibytes(putting.heap)} more heap and array buffers after a full collection and ${mebibytes(putting.resident)} more resident set; while getting it, ${mebibytes(getting.heap)} and ${mebibytes(getting.resident)}`;
}

async function measuredStream(store: LedgerStore, name: string): Promise<string> {
  const pieces = await piecesOf(generatedStream(streamedBytes, sampleSeed));
  const { sha256 } = await readThrough(streamOf(pieces).stream);
  const kept = await timed(() => put(store, playbook, streamOf(pieces)));
  const again = await timed(() => put(store, playbook, streamOf(pieces)));
  const givenItsDigest = await timed(() => put(store, playbook, { ...streamOf(pieces), expected: { sha256 } }));
  let read = await readBack(store, playbook, sha256);
  const got = await timed(async () => {
    read = await readBack(store, playbook, sha256);
  });
  write(
    `| ${name} | 64 MiB, streamed | ${milliseconds(kept)} | ${milliseconds(again)} | ${milliseconds(givenItsDigest)} | ${milliseconds(got)} | ${String(read?.sha256 === sha256 && read.bytes === streamedBytes)} |`,
  );
  return heldWhileStreamed(store, name, sha256);
}

const held: string[] = [];

async function measured({ name, opened }: MeasuredStore): Promise<void> {
  const store = await opened();
  await measuredText(store, name);
  held.push(await measuredStream(store, name));
  await store.close();
}

write(
  '| Store | Content | Kept | Kept again | Kept again, its digest given | Read back and parsed | Joined back exactly |',
);
write('| --- | --- | --- | --- | --- | --- | --- |');
await measuredOnEachStore(measured, { sqliteConnections: modestConnections });
write('');
held.forEach((line) => {
  write(line);
});

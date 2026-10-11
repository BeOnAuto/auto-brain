import { createHash, randomBytes } from 'node:crypto';

import {
  bytesOfText,
  contentOfText,
  textOfContent,
  type BrainAddress,
  type StreamedContent,
} from '@beonauto/operations';
import { Effect } from 'effect';

import { readThrough } from '../src/content/content-samples.ts';
import type { LedgerStore } from '../src/event-store.ts';
import { inTurn, measuredOnEachStore, timed, write, type MeasuredStore } from './stores.ts';

const sizes: readonly (readonly [string, number])[] = [
  ['100 B', 100],
  ['64 KiB', 65_536],
  ['1 MB', 1_000_000],
  ['5 MB', 5_000_000],
  ['20 MB', 20_000_000],
];

const brain = { org: 'acme', brain: 'alpha' };

const mebibyte = 1_048_576;

const blocksStreamed = 64;

const block = randomBytes(mebibyte);

function answerOfAbout(bytes: number): string {
  const rows: { readonly id: number; readonly note: string }[] = [];
  let size = 10;
  while (size < bytes) {
    const row = { id: rows.length, note: `${String(rows.length).repeat(6)} é ✓ 𝄞 ${'x'.repeat(48)}` };
    rows.push(row);
    size += bytesOfText(JSON.stringify(row)) + 1;
  }
  return JSON.stringify({ rows });
}

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function milliseconds(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 1)} ms`;
}

function heldNow(): number {
  globalThis.gc?.();
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
}

async function mostHeldDuring(work: () => Promise<unknown>): Promise<number> {
  const before = heldNow();
  let most = before;
  const sampling = setInterval(() => {
    most = Math.max(most, heldNow());
  }, 5);
  try {
    await work();
  } finally {
    clearInterval(sampling);
  }
  return most - before;
}

function streamedBlocks(): StreamedContent {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (sent === blocksStreamed) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(block);
    },
  });
  return { stream, bytes: blocksStreamed * mebibyte, mediaType: 'application/octet-stream' };
}

async function measuredText(store: LedgerStore, name: string): Promise<void> {
  await inTurn(sizes, async ([label, bytes]) => {
    const text = answerOfAbout(bytes);
    const sha256 = digestOf(text);
    const [first, second] = [contentOfText(text, 'application/json'), contentOfText(text, 'application/json')];
    const put = await timed(() => Effect.runPromise(store.content.put(brain, sha256, first)));
    const again = await timed(() => Effect.runPromise(store.content.put(brain, sha256, second)));
    let read = '';
    const get = await timed(async () => {
      const kept = await Effect.runPromise(store.content.get(brain, sha256));
      read = kept === undefined ? '' : await Effect.runPromise(textOfContent(kept));
      JSON.parse(read);
    });
    write(
      `| ${name} | ${label} | ${milliseconds(put)} | ${milliseconds(again)} | ${milliseconds(get)} | ${String(read === text)} |`,
    );
  });
}

async function readBack(store: LedgerStore, into: BrainAddress, sha256: string) {
  const kept = await Effect.runPromise(store.content.get(into, sha256));
  return kept === undefined ? undefined : readThrough(kept.stream);
}

async function heldWhileStreamed(store: LedgerStore, name: string, sha256: string): Promise<string> {
  const elsewhere = { org: 'acme', brain: 'beta' };
  const put = await mostHeldDuring(() => Effect.runPromise(store.content.put(elsewhere, sha256, streamedBlocks())));
  const got = await mostHeldDuring(() => readBack(store, elsewhere, sha256));
  return `${name}: at most ${(put / mebibyte).toFixed(1)} MiB more held while putting 64 MiB, ${(got / mebibyte).toFixed(1)} MiB while getting it`;
}

async function measuredStream(store: LedgerStore, name: string): Promise<string> {
  const { sha256 } = await readThrough(streamedBlocks().stream);
  const put = await timed(() => Effect.runPromise(store.content.put(brain, sha256, streamedBlocks())));
  const again = await timed(() => Effect.runPromise(store.content.put(brain, sha256, streamedBlocks())));
  let read = await readBack(store, brain, sha256);
  const get = await timed(async () => {
    read = await readBack(store, brain, sha256);
  });
  write(
    `| ${name} | 64 MiB, streamed | ${milliseconds(put)} | ${milliseconds(again)} | ${milliseconds(get)} | ${String(read?.sha256 === sha256 && read.bytes === blocksStreamed * mebibyte)} |`,
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

write('| Store | Answer | Kept | Kept again | Read back and parsed | Joined back exactly |');
write('| --- | --- | --- | --- | --- | --- |');
await measuredOnEachStore(measured);
write('');
held.forEach((line) => {
  write(line);
});

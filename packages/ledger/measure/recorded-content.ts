import { createHash } from 'node:crypto';

import { bytesOfText } from '@beonauto/operations';
import { Effect } from 'effect';

import { inTurn, measuredOnEachStore, timed, write, type MeasuredStore } from './stores.ts';

const sizes: readonly (readonly [string, number])[] = [
  ['100 B', 100],
  ['64 KiB', 65_536],
  ['1 MB', 1_000_000],
  ['5 MB', 5_000_000],
  ['20 MB', 20_000_000],
];

const brain = { org: 'acme', brain: 'alpha' };

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

async function measured({ name, opened }: MeasuredStore): Promise<void> {
  const store = await opened();
  await inTurn(sizes, async ([label, bytes]) => {
    const text = answerOfAbout(bytes);
    const sha256 = digestOf(text);
    const put = await timed(() => Effect.runPromise(store.content.put(brain, sha256, text)));
    const again = await timed(() => Effect.runPromise(store.content.put(brain, sha256, text)));
    let read = '';
    const get = await timed(async () => {
      read = (await Effect.runPromise(store.content.get(brain, sha256))) ?? '';
      JSON.parse(read);
    });
    write(
      `| ${name} | ${label} | ${milliseconds(put)} | ${milliseconds(again)} | ${milliseconds(get)} | ${String(read === text)} |`,
    );
  });
  await store.close();
}

write('| Store | Answer | Kept | Kept again | Read back and parsed | Joined back exactly |');
write('| --- | --- | --- | --- | --- | --- |');
await measuredOnEachStore(measured);

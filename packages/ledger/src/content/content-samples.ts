import { createHash } from 'node:crypto';

import {
  bytesOfText,
  textOfContent,
  type BrainAddress,
  type Digested,
  type StreamedContent,
} from '@beonauto/operations';
import { Effect } from 'effect';

export const alpha: BrainAddress = { org: 'acme', brain: 'alpha' };

export const beta: BrainAddress = { org: 'acme', brain: 'beta' };

export const octets = 'application/octet-stream';

export const json = 'application/json';

const pieceBytes = 65_537;

export interface ReadThrough extends Digested {
  readonly largestPiece: number;
}

export interface ReadBack extends ReadThrough {
  readonly mediaType: string;
  readonly declared: number;
}

export interface Generated {
  readonly sha256: string;
  readonly content: () => StreamedContent;
}

export interface Unread {
  readonly content: StreamedContent;
  readonly cancelled: () => boolean;
}

function generatedStream(bytes: number, seed: number): ReadableStream<Uint8Array> {
  let state = seed;
  let produced = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const size = Math.min(pieceBytes, bytes - produced);
      if (size === 0) {
        controller.close();
        return;
      }
      const piece = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        piece[index] = state & 0xff;
      }
      produced += size;
      controller.enqueue(piece);
    },
  });
}

export async function readThrough(stream: ReadableStream<Uint8Array>): Promise<ReadThrough> {
  const digest = createHash('sha256');
  let bytes = 0;
  let largestPiece = 0;
  for await (const piece of stream) {
    digest.update(piece);
    bytes += piece.byteLength;
    largestPiece = Math.max(largestPiece, piece.byteLength);
  }
  return { bytes, sha256: digest.digest('hex'), largestPiece };
}

export async function generated(bytes: number, seed = 7): Promise<Generated> {
  const { sha256 } = await readThrough(generatedStream(bytes, seed));
  return { sha256, content: () => ({ stream: generatedStream(bytes, seed), bytes, mediaType: octets }) };
}

export async function readBack(content: StreamedContent | undefined): Promise<ReadBack | undefined> {
  return content === undefined
    ? content
    : { ...(await readThrough(content.stream)), mediaType: content.mediaType, declared: content.bytes };
}

export function readText(content: StreamedContent | undefined): Effect.Effect<string | undefined> {
  return content === undefined ? Effect.succeed(content) : textOfContent(content);
}

export function run<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(effect);
}

export function unread(bytes: number): Unread {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { content: { stream, bytes, mediaType: octets }, cancelled: () => cancelled };
}

export function brokenAfter(bytes: number, declared: number): StreamedContent {
  let delivered = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (delivered) {
        controller.error(new Error('The connection dropped'));
        return;
      }
      delivered = true;
      controller.enqueue(new Uint8Array(bytes));
    },
  });
  return { stream, bytes: declared, mediaType: octets };
}

export function answerOfAbout(bytes: number): string {
  const rows: { readonly id: number; readonly note: string }[] = [];
  let size = 10;
  while (size < bytes) {
    const row = { id: rows.length, note: `${String(rows.length).repeat(8)} é ✓ 𝄞 \u0000 "quoted" ${'x'.repeat(40)}` };
    rows.push(row);
    size += bytesOfText(JSON.stringify(row)) + 1;
  }
  return JSON.stringify({ rows });
}

export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

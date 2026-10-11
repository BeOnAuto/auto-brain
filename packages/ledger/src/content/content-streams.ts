import { notTheBytesOfItsDigest, sha256Digest, type Digested } from '@beonauto/operations';

export interface Written extends Digested {
  readonly chunks: number;
}

export interface Head {
  readonly bytes: number;
  readonly chunks: number;
}

export type ChunkWrite = (chunk: Readonly<Uint8Array>, index: number) => Promise<unknown>;

export type ChunkRead = (index: number) => Promise<Uint8Array | undefined>;

async function* chunksOf(stream: ReadableStream<Uint8Array>, mostBytes: number): AsyncGenerator<Uint8Array> {
  let chunk = new Uint8Array(mostBytes);
  let filled = 0;
  for await (const part of stream) {
    for (let taken = 0; taken < part.byteLength;) {
      const copied = Math.min(mostBytes - filled, part.byteLength - taken);
      chunk.set(part.subarray(taken, taken + copied), filled);
      filled += copied;
      taken += copied;
      if (filled === mostBytes) {
        yield chunk;
        chunk = new Uint8Array(mostBytes);
        filled = 0;
      }
    }
  }
  if (filled > 0) {
    yield chunk.subarray(0, filled);
  }
}

export async function writtenInChunks(
  stream: ReadableStream<Uint8Array>,
  mostBytes: number,
  write: ChunkWrite,
): Promise<Written> {
  const digest = sha256Digest();
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of chunksOf(stream, mostBytes)) {
    digest.update(chunk);
    await write(chunk, chunks);
    bytes += chunk.byteLength;
    chunks += 1;
  }
  return { bytes, chunks, sha256: digest.hex() };
}

export function verifiedStream(sha256: string, head: Head, read: ChunkRead): ReadableStream<Uint8Array> {
  const digest = sha256Digest();
  let bytes = 0;
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const chunk = index < head.chunks ? await read(index) : undefined;
      if (chunk !== undefined) {
        digest.update(chunk);
        bytes += chunk.byteLength;
        index += 1;
        controller.enqueue(chunk);
      } else if (index === head.chunks && bytes === head.bytes && digest.hex() === sha256) {
        controller.close();
      } else {
        controller.error(notTheBytesOfItsDigest(sha256));
      }
    },
  });
}

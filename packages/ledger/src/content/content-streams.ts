import { notTheBytesOfItsDigest, sha256Digest } from '@beonauto/operations';

export interface Head {
  readonly bytes: number;
  readonly chunks: number;
}

export type ChunkRead = (index: number) => Promise<Uint8Array | undefined>;

export function verifiedStream(sha256: string, head: Head, read: ChunkRead): ReadableStream<Uint8Array> {
  const digest = sha256Digest();
  let bytes = 0;
  let index = 0;
  const ended = (controller: ReadableStreamDefaultController<Uint8Array>, last?: Readonly<Uint8Array>) => {
    if (bytes !== head.bytes || digest.hex() !== sha256) {
      controller.error(notTheBytesOfItsDigest(sha256));
      return;
    }
    if (last !== undefined) {
      controller.enqueue(last);
    }
    controller.close();
  };
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      if (index === head.chunks) {
        ended(controller);
        return;
      }
      const chunk = await read(index);
      if (chunk === undefined) {
        controller.error(notTheBytesOfItsDigest(sha256));
        return;
      }
      digest.update(chunk);
      bytes += chunk.byteLength;
      index += 1;
      if (index < head.chunks) {
        controller.enqueue(chunk);
      } else {
        ended(controller, chunk);
      }
    },
  });
}

export const mostContentChunkBytes = 1_048_576;

const utf8 = new TextEncoder();

const longestCodePointBytes = 4;

export function chunksOf(text: string, mostBytes: number = mostContentChunkBytes): readonly string[] {
  if (mostBytes < longestCodePointBytes) {
    throw new RangeError(`A chunk holds at least the ${longestCodePointBytes} bytes of one code point`);
  }
  const buffer = new Uint8Array(mostBytes);
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const { read } = utf8.encodeInto(text.slice(start, start + mostBytes + 1), buffer);
    chunks.push(text.slice(start, start + read));
    start += read;
  }
  return chunks;
}

export function bytesOfText(text: string): number {
  return utf8.encode(text).byteLength;
}

export async function sha256Of(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

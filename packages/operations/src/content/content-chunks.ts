export const mostContentChunkBytes = 1_048_576;

const utf8 = new TextEncoder();

const longestCodePointBytes = 4;

export interface Digested {
  readonly bytes: number;
  readonly sha256: string;
}

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

export async function sha256Of(content: string | Readonly<Uint8Array>): Promise<string> {
  const bytes = typeof content === 'string' ? utf8.encode(content) : new Uint8Array(content);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function requireAsDeclared(sha256: string, declaredBytes: number, digested: Digested): void {
  if (digested.bytes !== declaredBytes) {
    throw new Error(
      `The content put under ${sha256} holds ${digested.bytes} bytes, not the ${declaredBytes} it declares`,
    );
  }
  if (digested.sha256 !== sha256) {
    throw new Error(`The content put under ${sha256} is not the bytes that digest names`);
  }
}

export function notTheBytesOfItsDigest(sha256: string): Error {
  return new Error(`The content kept under ${sha256} is not the bytes that digest names`);
}

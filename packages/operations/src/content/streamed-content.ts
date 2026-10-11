import { Effect, Predicate } from 'effect';

export interface StreamedContent {
  readonly stream: ReadableStream<Uint8Array>;
  readonly bytes: number;
  readonly mediaType: string;
}

export function isStreamedContent(value: unknown): value is StreamedContent {
  return Predicate.hasProperty(value, 'stream') && value.stream instanceof ReadableStream;
}

export function contentOfText(text: string, mediaType: string): StreamedContent {
  const blob = new Blob([text]);
  return { stream: blob.stream(), bytes: blob.size, mediaType };
}

export function contentOfBytes(bytes: Readonly<Uint8Array>, mediaType: string): StreamedContent {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { stream: blob.stream(), bytes: blob.size, mediaType };
}

async function decoded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  for await (const part of stream) {
    text += utf8.decode(part, { stream: true });
  }
  return `${text}${utf8.decode()}`;
}

export function textOfContent({ stream }: StreamedContent): Effect.Effect<string> {
  return Effect.promise(() => decoded(stream));
}

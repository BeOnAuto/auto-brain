import { Data } from 'effect';

export type ContentRefusedBecause = 'not_its_digest' | 'not_its_size' | 'stream_failed';

export class ContentRefused extends Data.TaggedError('content_refused')<{
  readonly because: ContentRefusedBecause;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export function notItsDigest(sha256: string, expected: string): ContentRefused {
  return new ContentRefused({
    because: 'not_its_digest',
    detail: `The content's SHA-256 is ${sha256}, where ${expected} was expected`,
  });
}

export function notItsSize(bytes: number, expected: number): ContentRefused {
  return new ContentRefused({
    because: 'not_its_size',
    detail: `The content holds ${bytes} bytes, where ${expected} were expected`,
  });
}

export function streamFailed(cause: unknown): ContentRefused {
  return new ContentRefused({ because: 'stream_failed', detail: "The content's stream failed before its end", cause });
}

export function notTheBytesOfItsDigest(sha256: string): Error {
  return new Error(`The content kept under ${sha256} is not the bytes that digest names`);
}

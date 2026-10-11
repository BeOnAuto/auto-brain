import { mediaTypeOfBody, type StreamedBody, type StreamedContent } from '@beonauto/operations';
import { Result } from 'effect';

import { problemOf, type Problem } from '../problem/problem.ts';
import { isIdentity, mediaTypeOf } from './request-body.ts';

const encoded = Result.fail(
  problemOf('unsupported_media_type', 'A body must be sent without a Content-Encoding other than identity'),
);

const notUtf8 = Result.fail(problemOf('unsupported_media_type', 'A body must be encoded as UTF-8'));

const lengthRequired = Result.fail(problemOf('length_required', 'A body must be sent with a Content-Length'));

const malformedLength = Result.fail(problemOf('bad_request', 'The Content-Length must be a whole number of bytes'));

const wholeNumber = /^\d+$/u;

function sentAsAnother(mediaType: string): Result.Result<never, Problem> {
  return Result.fail(problemOf('unsupported_media_type', `A body must be sent as ${mediaType}`));
}

function tooLarge(mostBytes: number): Result.Result<never, Problem> {
  return Result.fail(
    problemOf(
      'content_too_large',
      `The body is larger than the ${mostBytes.toLocaleString('en-US')} bytes this operation takes`,
    ),
  );
}

function sizeOf(length: string | null, mostBytes: number): Result.Result<number, Problem> {
  if (length === null) {
    return lengthRequired;
  }
  if (!wholeNumber.test(length)) {
    return malformedLength;
  }
  const bytes = Number(length);
  return bytes > mostBytes ? tooLarge(mostBytes) : Result.succeed(bytes);
}

export function streamedBodyOf(
  request: Request,
  { kind, mostBytes }: StreamedBody,
): Result.Result<StreamedContent, Problem> {
  const mediaType = mediaTypeOfBody[kind];
  const sent = mediaTypeOf(request.headers.get('content-type'));
  if (!isIdentity(request.headers.get('content-encoding'))) {
    return encoded;
  }
  if (sent.type !== mediaType) {
    return sentAsAnother(mediaType);
  }
  if (sent.charset !== undefined && sent.charset !== 'utf-8') {
    return notUtf8;
  }
  return Result.map(sizeOf(request.headers.get('content-length'), mostBytes), (bytes) => ({
    stream: request.body ?? new Blob().stream(),
    bytes,
    mediaType,
  }));
}

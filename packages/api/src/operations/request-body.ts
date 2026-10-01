import { Predicate, Result } from 'effect';

import { problemOf, type Problem } from '../problem/problem.ts';

export type Fields = Readonly<Record<string, unknown>>;

const bodyLimit = 1024 * 1024;

const tooLarge = Result.fail(problemOf('payload_too_large', 'The body is larger than 1 MiB'));

const notJson = Result.fail(problemOf('unsupported_media_type', 'A body must be sent as application/json'));

const notAnObject = Result.fail(problemOf('bad_request', 'The body must be a JSON object'));

const unreadable = Result.fail(problemOf('bad_request', 'The body could not be read as UTF-8 text'));

async function bodyTextOf(request: Request): Promise<Result.Result<string, Problem>> {
  if (request.body === null) {
    return Result.succeed('');
  }
  if (Number(request.headers.get('content-length')) > bodyLimit) {
    return tooLarge;
  }
  const chunks = request.body.pipeThrough(new TextDecoderStream('utf-8', { fatal: true }));
  let size = 0;
  let text = '';
  try {
    for await (const chunk of chunks) {
      size += Buffer.byteLength(chunk);
      if (size > bodyLimit) {
        return tooLarge;
      }
      text += chunk;
    }
  } catch {
    return unreadable;
  }
  return Result.succeed(text);
}

function isJson(contentType: string | null): boolean {
  return (contentType ?? '').split(';', 1).join('').trim().toLowerCase() === 'application/json';
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function fieldsOf(text: string, contentType: string | null): Result.Result<Fields, Problem> {
  if (text === '') {
    return Result.succeed({});
  }
  if (!isJson(contentType)) {
    return notJson;
  }
  const body = parsed(text);
  return Predicate.isReadonlyObject(body) ? Result.succeed(body) : notAnObject;
}

export async function jsonBodyOf(request: Request): Promise<Result.Result<Fields, Problem>> {
  return Result.flatMap(await bodyTextOf(request), (text) => fieldsOf(text, request.headers.get('content-type')));
}

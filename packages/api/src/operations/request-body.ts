import { Predicate, Result } from 'effect';

import { problemOf, type Problem } from '../problem/problem.ts';

export type JsonObject = Readonly<Record<string, unknown>>;

interface MediaType {
  readonly type: string;
  readonly charset: string | undefined;
}

const bodyLimit = 1024 * 1024;

const tooLarge = Result.fail(problemOf('payload_too_large', 'The body is larger than 1 MiB'));

const notJson = Result.fail(problemOf('unsupported_media_type', 'A body must be sent as application/json'));

const encoded = Result.fail(
  problemOf('unsupported_media_type', 'A body must be sent without a Content-Encoding other than identity'),
);

const notUtf8 = Result.fail(problemOf('unsupported_media_type', 'A JSON body must be encoded as UTF-8'));

const notAnObject = Result.fail(problemOf('bad_request', 'The body must be a JSON object'));

const unreadable = Result.fail(problemOf('bad_request', 'The body could not be read as UTF-8 text'));

function mediaTypeOf(contentType: string | null): MediaType {
  const [type = '', ...parameters] = (contentType ?? '').split(';');
  const charset = parameters
    .map((parameter) => parameter.trim().toLowerCase())
    .find((parameter) => parameter.startsWith('charset='))
    ?.slice('charset='.length);
  return { type: type.trim().toLowerCase(), charset: charset?.replace(/^"(.*)"$/u, '$1') };
}

function isIdentity(contentEncoding: string | null): boolean {
  return contentEncoding === null || ['', 'identity'].includes(contentEncoding.trim().toLowerCase());
}

function declaresAnotherCharset({ type, charset }: MediaType): boolean {
  return type === 'application/json' && charset !== undefined && charset !== 'utf-8';
}

async function bodyTextOf(request: Request): Promise<Result.Result<string, Problem>> {
  if (request.body === null) {
    return Result.succeed('');
  }
  if (!isIdentity(request.headers.get('content-encoding'))) {
    return encoded;
  }
  if (declaresAnotherCharset(mediaTypeOf(request.headers.get('content-type')))) {
    return notUtf8;
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

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function fieldsOf(text: string, contentType: string | null): Result.Result<JsonObject, Problem> {
  if (text === '') {
    return Result.succeed({});
  }
  if (mediaTypeOf(contentType).type !== 'application/json') {
    return notJson;
  }
  const body = parsed(text);
  return Predicate.isReadonlyObject(body) ? Result.succeed(body) : notAnObject;
}

export async function parseJsonBody(request: Request): Promise<Result.Result<JsonObject, Problem>> {
  return Result.flatMap(await bodyTextOf(request), (text) => fieldsOf(text, request.headers.get('content-type')));
}

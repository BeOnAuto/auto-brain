import { Predicate } from 'effect';

import { read, refusedWith, type Readout } from './readout.ts';

export type Fields = Readonly<Record<string, unknown>>;

const bodyLimit = 1024 * 1024;

const tooLarge = refusedWith('payload_too_large', 'The body is larger than 1 MiB');

const notJson = refusedWith('unsupported_media_type', 'A body must be sent as application/json');

const notAnObject = refusedWith('malformed_request', 'The body must be a JSON object');

const unreadable = refusedWith('malformed_request', 'The body could not be read as UTF-8 text');

async function bodyTextOf(request: Request): Promise<Readout<string>> {
  if (request.body === null) {
    return read('');
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
  return read(text);
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

export async function jsonBodyOf(request: Request): Promise<Readout<Fields>> {
  const text = await bodyTextOf(request);
  if (text.status === 'refused') {
    return text;
  }
  if (text.value === '') {
    return read({});
  }
  if (!isJson(request.headers.get('content-type'))) {
    return notJson;
  }
  const body = parsed(text.value);
  return Predicate.isReadonlyObject(body) ? read(body) : notAnObject;
}

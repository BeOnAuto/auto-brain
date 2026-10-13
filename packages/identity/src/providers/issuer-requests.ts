import { Predicate, Result } from 'effect';

export type IssuerFetch = (request: Readonly<Request>) => Promise<Response>;

export interface IssuerRequests {
  readonly fetch: IssuerFetch;
  readonly now: () => number;
}

export const issuerRequestsOverTheNetwork: IssuerRequests = { fetch: (request) => fetch(request), now: Date.now };

const issuerAnswerMs = 10_000;

const utf8 = new TextDecoder('utf-8', { fatal: true });

async function bytesUpTo(body: ReadableStream<Uint8Array> | null, mostBytes: number): Promise<Buffer | undefined> {
  if (body === null) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > mostBytes) {
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function unreached(error: unknown): string {
  return Predicate.hasProperty(error, 'name') && error.name === 'TimeoutError'
    ? `does not answer within ${issuerAnswerMs / 1000} seconds`
    : 'cannot be reached';
}

async function answerOf(response: Readonly<Response>, mostBytes: number): Promise<Result.Result<unknown, string>> {
  if (!response.ok) {
    await response.body?.cancel();
    return Result.fail(`answers ${response.status}`);
  }
  const bytes = await bytesUpTo(response.body, mostBytes);
  if (bytes === undefined) {
    return Result.fail(`answers more than ${mostBytes / 1024} KiB`);
  }
  return Result.try({ try: (): unknown => JSON.parse(utf8.decode(bytes)), catch: () => 'answers no JSON' });
}

export async function jsonAt(
  { fetch }: IssuerRequests,
  address: string,
  mostBytes: number,
): Promise<Result.Result<unknown, string>> {
  const request = new Request(address, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(issuerAnswerMs),
  });
  try {
    return await answerOf(await fetch(request), mostBytes);
  } catch (error) {
    return Result.fail(unreached(error));
  }
}

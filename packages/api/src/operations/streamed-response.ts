import type { Failed, StreamedContent } from '@beonauto/operations';
import { Result } from 'effect';

import { internalErrorProblem, problemResponse } from '../problem/problem.ts';

export interface StreamServing {
  readonly status: number;
  readonly failed: (thrown: unknown) => Failed;
  readonly abortConnection: () => void;
}

type Read = Readonly<{ done: false; value: Readonly<Uint8Array> }> | Readonly<{ done: true }>;

type ReadOutcome = Result.Result<Read, unknown>;

async function readOf(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadOutcome> {
  try {
    return Result.succeed(await reader.read());
  } catch (thrown) {
    return Result.fail(thrown);
  }
}

function restOf(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  first: Read,
  { failed, abortConnection }: StreamServing,
) {
  const handedOver = (controller: ReadableStreamDefaultController<Uint8Array>, read: Read) => {
    if (read.done) {
      controller.close();
    } else {
      controller.enqueue(read.value);
    }
  };
  const brokenOff = (controller: ReadableStreamDefaultController<Uint8Array>, thrown: unknown) => {
    const { incident } = failed(thrown);
    abortConnection();
    controller.error(new Error(`The streamed answer failed before its end; incident ${incident}`));
  };
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      handedOver(controller, first);
    },
    pull: async (controller) => {
      const read = await readOf(reader);
      if (Result.isFailure(read)) {
        brokenOff(controller, read.failure);
      } else {
        handedOver(controller, read.success);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export async function streamedResponse(
  { stream, bytes, mediaType }: StreamedContent,
  serving: StreamServing,
): Promise<Response> {
  const reader = stream.getReader();
  const first = await readOf(reader);
  if (Result.isFailure(first)) {
    return problemResponse(internalErrorProblem(serving.failed(first.failure).incident));
  }
  return new Response(restOf(reader, first.success, serving), {
    status: serving.status,
    headers: { 'content-type': mediaType, 'content-length': String(bytes), 'cache-control': 'no-store' },
  });
}

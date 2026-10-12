import { Option, Schema } from 'effect';

import { readySignal } from '../jobs/job-envelopes.ts';
import { outOfMemoryExitCode, ProcessJobSchema, type ProcessAnswer } from './process-messages.ts';
import { valueOf, wireOf, type ProcessValue } from './process-values.ts';

export type ProcessHandler = (payload: ProcessValue) => ProcessValue | Promise<ProcessValue>;

export type ProcessHandlers = Readonly<Record<string, ProcessHandler>>;

export interface ProcessHost {
  readonly send?: ((message: unknown) => boolean) | undefined;
  readonly on: (event: 'message', listener: (message: unknown) => void) => unknown;
  readonly exit: (code: number) => void;
}

const decodeJob = Schema.decodeUnknownOption(ProcessJobSchema);

const unreadableJob = 'The process could not read the job it was sent';

const unreadablePayload = 'The process could not read the payload of its job';

function jobNamedIn(message: unknown): number {
  const job: unknown = Reflect.get(new Object(message), 'job');
  return typeof job === 'number' ? job : -1;
}

function isAllocationFailure(error: unknown): boolean {
  return error instanceof RangeError && /allocation failed/u.test(error.message);
}

function handlerOf(handlers: ProcessHandlers, kind: string): ProcessHandler | undefined {
  return Object.hasOwn(handlers, kind) ? handlers[kind] : undefined;
}

async function answered(
  handler: ProcessHandler,
  job: number,
  payload: ProcessValue,
  host: ProcessHost,
): Promise<ProcessAnswer> {
  try {
    return { job, answer: wireOf(await handler(payload)), keep: true };
  } catch (error) {
    if (isAllocationFailure(error)) {
      host.exit(outOfMemoryExitCode);
    }
    return { job, failed: String(error) };
  }
}

function answerTo(message: unknown, handlers: ProcessHandlers, host: ProcessHost): Promise<ProcessAnswer> {
  const envelope = decodeJob(message);
  if (Option.isNone(envelope)) {
    return Promise.resolve({ job: jobNamedIn(message), failed: unreadableJob });
  }
  const { job, kind, payload } = envelope.value;
  const handler = handlerOf(handlers, kind);
  const value = valueOf(payload);
  if (handler === undefined) {
    return Promise.resolve({ job, failed: `This process serves no job of the kind ${kind}` });
  }
  return value === undefined
    ? Promise.resolve({ job, failed: unreadablePayload })
    : answered(handler, job, value, host);
}

export function serveProcessJobs(handlers: ProcessHandlers, host: ProcessHost): void {
  if (host.send === undefined) {
    return;
  }
  host.on('message', (message) => {
    void answerTo(message, handlers, host).then((answer) => host.send?.(answer));
  });
  host.send(readySignal);
}

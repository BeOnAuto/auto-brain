import { parentPort, type MessagePort } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import type { FoldAnswerData } from '../folds/fold-answer.ts';
import { progressOf } from '../folds/fold-progress.ts';
import { JobSchema, type JobAnswer, type JobEnvelope } from '../jobs/job-envelopes.ts';
import { keptFor, type FoldHandler, type JobHandlers, type Kept, type ProgramHandler } from '../jobs/job-kit.ts';
import type { ProgramAnswerData } from '../jobs/program-answer.ts';
import { fieldOf } from '../programs/program-tree.ts';

type ProgramEnvelope = Extract<JobEnvelope, { readonly kind: 'program' }>;

type FoldEnvelope = Extract<JobEnvelope, { readonly kind: 'fold' }>;

const decodeJob = Schema.decodeUnknownOption(JobSchema);

const unreadable: FoldAnswerData = { ran: 'unreadable' };

function now(): number {
  return performance.timeOrigin + performance.now();
}

function keepsAfterProgram(answer: ProgramAnswerData): boolean {
  return answer.ran !== 'exhausted' || answer.limit !== 'deadline';
}

function keepsAfterFold(answer: FoldAnswerData): boolean {
  return answer.ran === 'folded' && answer.views.every(({ overtime }) => overtime === undefined);
}

function programAnswer({ job, request }: ProgramEnvelope, handler: ProgramHandler | undefined, kept: Kept): JobAnswer {
  if (handler === undefined) {
    return { job, answer: unreadable, keep: false };
  }
  const answer = handler(request, { now, compile: kept.compile, check: kept.outputCheck(request.context) });
  return { job, answer, keep: keepsAfterProgram(answer) };
}

function foldAnswer({ job, request, progress }: FoldEnvelope, handler: FoldHandler | undefined, kept: Kept): JobAnswer {
  if (handler === undefined) {
    return { job, answer: unreadable, keep: false };
  }
  const { mark } = progressOf(progress);
  const answer = handler(request, { now, folding: mark, checkOf: kept.viewCheck, compile: kept.compile });
  return { job, answer, keep: keepsAfterFold(answer) };
}

function jobNamedIn(message: unknown): number {
  const job = fieldOf(message, 'job');
  return typeof job === 'number' ? job : -1;
}

function answerTo(message: unknown, handlers: JobHandlers, kept: Kept): JobAnswer {
  const envelope = decodeJob(message);
  if (Option.isNone(envelope)) {
    return { job: jobNamedIn(message), answer: unreadable, keep: false };
  }
  return envelope.value.kind === 'program'
    ? programAnswer(envelope.value, handlers.program, kept)
    : foldAnswer(envelope.value, handlers.fold, kept);
}

export function serveJobs(handlers: JobHandlers, port: MessagePort | null = parentPort): void {
  if (port === null) {
    return;
  }
  const kept = keptFor(handlers.checks);
  port.on('message', (message: unknown) => {
    port.postMessage(answerTo(message, handlers, kept), []);
  });
}

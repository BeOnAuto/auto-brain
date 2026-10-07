import { afterEach, describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { foldAnswerOf, foldPageData } from '../folds/fold-answer.ts';
import type { FoldPage } from '../folds/fold-page.ts';
import { foldProgress, type FoldProgress } from '../folds/fold-progress.ts';
import { answerOf, type OutputCheck, type ProgramAnswerData } from '../jobs/program-answer.ts';
import type { CompiledProgram } from '../programs/program-compiling.ts';
import type { JobHandlers } from './job-kit.ts';
import { serveJobs } from './job-loop.ts';
import { liftedLimits } from './program-pool.ts';

type Ask = (message: unknown) => Promise<unknown>;

const noSchemaChecked: unknown = expect.stringContaining('checks no view schema');

interface FoldJobParts {
  readonly page?: Partial<FoldPage>;
  readonly events?: string;
  readonly progress?: FoldProgress;
}

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const { port1, port2 } of channels.splice(0)) {
    port1.close();
    port2.close();
  }
});

function served(handlers: JobHandlers): Ask {
  const { port1, port2 } = new MessageChannel();
  channels.push({ port1, port2 });
  serveJobs(handlers, port1);
  return (message) => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    port2.once('message', (answer: unknown) => {
      resolve(answer);
    });
    port2.postMessage(message, []);
    return promise;
  };
}

function inTurn(ask: Ask, messages: readonly unknown[]): Promise<readonly unknown[]> {
  return messages.reduce<Promise<readonly unknown[]>>(
    async (before, message) => [...(await before), await ask(message)],
    Promise.resolve([]),
  );
}

async function keptAfter(ask: Ask, messages: readonly unknown[]): Promise<readonly unknown[]> {
  return (await inTurn(ask, messages)).map((answer): unknown => Reflect.get(new Object(answer), 'keep'));
}

function programJob(job: number, source: string, more: Readonly<Record<string, Json>> = {}): unknown {
  const deadlineAt = performance.timeOrigin + performance.now() + 10_000;
  const limits = liftedLimits(64_000_000);
  const dialect = { refused: [], variables: [] };
  const request = {
    source,
    input: '1',
    variables: '{}',
    dialect,
    limits,
    mostOutputBytes: 1000,
    deadlineAt,
    context: null,
  };
  return { job, kind: 'program', request: { ...request, ...more } };
}

function foldJob(job: number, views: readonly JsonObject[], parts: FoldJobParts = {}): unknown {
  const request = foldPageData({
    events: [{ type: 'noted', data: 2 }],
    views: views.map((view) => ({
      fold: '. + $event.data',
      filters: [{ type: 'noted' }],
      view: 1,
      events: [0],
      ...view,
    })),
    dialect: { refused: [], variables: ['event'] },
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 1000,
    ...parts.page,
  });
  const progress = parts.progress ?? foldProgress();
  return {
    job,
    kind: 'fold',
    request: { ...request, events: parts.events ?? request.events },
    progress: progress.shared,
  };
}

function refusingEvery(detail: string): OutputCheck {
  return () => [{ pointer: '', detail }];
}

describe('a loop that serves jobs', () => {
  it('answers each job by its id, with the answer of the handler of its kind and whether the worker may be kept', async () => {
    const ask = served({ program: answerOf, fold: foldAnswerOf });

    expect(await inTurn(ask, [programJob(3, '. + 1'), foldJob(4, [{}])])).toMatchObject([
      { job: 3, answer: { ran: 'answered', output: '2', bytes: 1 }, keep: true },
      { job: 4, answer: { ran: 'folded', views: [{ view: '3', folded: 1 }] }, keep: true },
    ]);
  });

  it('marks the place of each fold in the memory the envelope shares, so the pool can name the fold that was going', async () => {
    const progress = foldProgress();

    await served({ fold: foldAnswerOf })(foldJob(1, [{}, {}], { progress }));

    expect(progress.last()).toEqual({ event: 0, view: 1 });
  });

  it('keeps its worker after every program but one its deadline ended, and after every page but one with a view past its deadline', async () => {
    const ask = served({ program: answerOf, fold: foldAnswerOf });
    const pastItsDeadline = { deadlineAt: performance.timeOrigin + performance.now() - 1 };

    expect(
      await keptAfter(ask, [
        programJob(1, 'error("stop")'),
        programJob(2, '"x" * 100000000'),
        programJob(3, 'def g: if . == 0 then 0 else (. - 1 | g) end; 30000 | g'),
        programJob(4, 'empty'),
        programJob(5, 'reduce range(100000000) as $i (0; . + 1)', pastItsDeadline),
        foldJob(6, [{ fold: 'error("stop")' }]),
        foldJob(7, [{ fold: 'reduce range(1000000) as $i (.; . + 1)' }, {}], { page: { foldDeadlineMs: 1 } }),
      ]),
    ).toEqual([true, true, true, true, false, true, false]);
  });
});

describe('a loop given a job it cannot serve', () => {
  it('answers a page whose events it cannot read as unreadable, and does not keep its worker', async () => {
    expect(await served({ fold: foldAnswerOf })(foldJob(1, [{}], { events: '{' }))).toEqual({
      job: 1,
      answer: { ran: 'unreadable' },
      keep: false,
    });
  });

  it('answers what is not an envelope, or a kind it has no handler for, as unreadable, naming the job when it can', async () => {
    const programs = served({ program: answerOf });
    const folds = served({ fold: foldAnswerOf });

    expect([
      ...(await inTurn(programs, [{ nonsense: true }, { job: 8, kind: 'program' }, foldJob(9, [{}])])),
      await folds(programJob(10, '.')),
    ]).toEqual([
      { job: -1, answer: { ran: 'unreadable' }, keep: false },
      { job: 8, answer: { ran: 'unreadable' }, keep: false },
      { job: 9, answer: { ran: 'unreadable' }, keep: false },
      { job: 10, answer: { ran: 'unreadable' }, keep: false },
    ]);
  });
});

describe('the programs a loop keeps between jobs', () => {
  it('compiles a program once for each source and dialect, and gives the same program to every job that runs it', async () => {
    const seen: CompiledProgram[] = [];
    const ask = served({
      program: (request, host): ProgramAnswerData => {
        seen.push(host.compile(request.source, request.dialect));
        return answerOf(request, host);
      },
    });

    await inTurn(ask, [
      programJob(1, '. + 1'),
      programJob(2, '. + 1'),
      programJob(3, '. + 1', { dialect: { refused: [{ name: 'now', why: 'reads the clock' }] } }),
      programJob(4, '. + 2'),
    ]);

    const [first, again, otherDialect, otherSource] = seen;
    expect([again === first, otherDialect === first, otherSource === first]).toEqual([true, false, false]);
  });
});

describe('the output checks a loop keeps between jobs', () => {
  it('compiles the check of a context once for each schema, and checks nothing when a job gives none or the loop was given no checks', async () => {
    const compiled: Json[] = [];
    const output = (schema: Json): OutputCheck => {
      compiled.push(schema);
      return refusingEvery('refused by the check');
    };
    const ask = served({ program: answerOf, checks: { output, view: () => () => 'never asked' } });
    const string = { context: { type: 'string' } };

    expect(
      await inTurn(ask, [programJob(1, '.', string), programJob(2, '.', string), programJob(3, '.')]),
    ).toMatchObject([
      { answer: { ran: 'mismatched', issues: [{ detail: 'refused by the check' }] } },
      { answer: { ran: 'mismatched' } },
      { answer: { ran: 'answered' } },
    ]);
    expect(compiled).toEqual([{ type: 'string' }]);
    expect(await served({ program: answerOf })(programJob(4, '.', string))).toMatchObject({
      answer: { ran: 'answered' },
    });
  });
});

describe('the view checks a loop keeps between pages', () => {
  it('compiles the check of a schema once for each schema, and stalls every view that keeps one when it was given no checks', async () => {
    const compiled: Json[] = [];
    const view = (schema: JsonObject): (() => string) => {
      compiled.push(schema);
      return () => 'refused by the check';
    };
    const ask = served({ fold: foldAnswerOf, checks: { output: () => refusingEvery('never asked'), view } });
    const integer = { schema: { type: 'integer' } };

    expect(await inTurn(ask, [foldJob(1, [integer, integer]), foldJob(2, [integer])])).toMatchObject([
      { answer: { views: [{ stall: { message: 'refused by the check' } }, { stall: { kind: 'schema' } }] } },
      { answer: { views: [{ stall: { kind: 'schema' } }] } },
    ]);
    expect(compiled).toEqual([{ type: 'integer' }]);
    expect(await served({ fold: foldAnswerOf })(foldJob(3, [integer]))).toMatchObject({
      answer: { views: [{ stall: { kind: 'schema', message: noSchemaChecked } }] },
    });
  });
});

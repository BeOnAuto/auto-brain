import { Conflict, Unavailable } from '@beonauto/operations';
import type { PoolOutcome } from '@beonauto/workflow-engine/dsl';
import { scriptedPool } from '@beonauto/workflow-engine/testing';
import { Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith, workerTestTimeoutMs } from '../testing/recall-runs.ts';

const succeeded = 'language: typescript\nsource:\n  events:\n    - type: run_succeeded';

function unworkable(detail: string): Exit.Exit<never, Conflict> {
  return Exit.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function answering(answer: string, more = ''): string {
  return recallDocument(foldOf('return view;', answer), `${succeeded}${more}`);
}

const springWithoutReviews = { spring: [] };

const noInput = {};

function ended(source: string, view: Schema.Json = springWithoutReviews, input: Schema.Json = noInput) {
  const run = recallWith();
  run.keep(liveView(view));
  return run.running(source, input);
}

const stoppedWhen: readonly (readonly [PoolOutcome, string])[] = [
  [
    { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
    'No worker was free to answer within 10000 ms; this server runs 2 programs at once',
  ],
  [
    { ran: 'stopped', because: 'memory', milliseconds: 10 },
    "The answer's worker took more than the 256 MiB of heap it may use, and was stopped",
  ],
  [
    { ran: 'stopped', because: 'deadline', milliseconds: 10_000 },
    'The answer took longer than the 10000 ms a recall function may run, and was stopped',
  ],
  [{ ran: 'stopped', because: 'cancelled', milliseconds: 1 }, 'The run was stopped before it ended'],
  [{ ran: 'stopped', because: 'closing', milliseconds: 1 }, 'The server is stopping'],
  [
    {
      ran: 'exhausted',
      limit: 'deadline',
      issue: { detail: 'The program ran past its deadline', line: null },
      work: 5,
      milliseconds: 10_000,
    },
    'The answer took longer than the 10000 ms a recall function may run, and was stopped',
  ],
];

const brokenWhen: readonly (readonly [PoolOutcome, string])[] = [
  [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
  [
    { ran: 'refused', issue: { detail: 'The program exports no function answer', line: null }, milliseconds: 1 },
    'The worker refused an answer the definition was accepted with: The program exports no function answer',
  ],
];

describe('a run whose answer cannot work as written', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict, unworkable, with the error the answer raised and its line in the document', async () => {
    expect(await ended(answering('throw new Error(`no campaign ${view.spring.length}`);'))).toEqual(
      unworkable('The answer raised an error on line 12: Error: no campaign 0'),
    );
    expect(await ended(answering('return view.autumn.length;'))).toEqual(
      unworkable("The answer raised an error on line 12: TypeError: cannot read property 'length' of undefined"),
    );
    expect(await ended(answering("throw 'no campaign';"))).toEqual(
      unworkable('The answer raised an error: no campaign'),
    );
  });

  it('ends in conflict when its answer, or the view it answers, is not what the output schema allows, checked in the worker', async () => {
    expect(await ended(campaignReviews, { spring: [1] }, { campaign: 'spring' })).toEqual(
      unworkable('The answer does not match the output schema: /0: Expected object'),
    );
    expect(
      await ended(recallDocument(foldOf('return view;'), `${succeeded}\noutput: {schema: {type: array}}`), {
        spring: [],
      }),
    ).toEqual(unworkable('The view does not match the output schema: the output: Expected array'));
    expect(
      await ended(
        recallDocument(
          foldOf('return view;'),
          `${succeeded}\noutput: {schema: {properties: {spring: {type: string}}}}`,
        ),
      ),
    ).toEqual(unworkable('The view does not match the output schema: /spring: Expected string'));
    expect(await ended(answering('return [view.spring];', '\noutput: {schema: {type: object}}'))).toEqual(
      unworkable('The answer does not match the output schema: the output: Expected object'),
    );
  });

  it('ends in conflict when its answer is not JSON, or takes more than a run can record beside its record', async () => {
    expect(await ended(answering('return 0 / 0;'))).toEqual(
      unworkable('The answer is not JSON: The answer holds NaN at $, which JSON cannot carry'),
    );
    expect(await ended(answering('return "x".repeat(1100000);'))).toEqual(
      unworkable('The answer takes more than the 1046528 bytes as JSON a run can record'),
    );
  });
});

describe('a run whose answer reaches a bound', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict when it does more work than a run may, or uses more memory', async () => {
    expect(await ended(answering('for (;;) {}'))).toEqual(
      unworkable('The answer did more work than a run may, 500 checkpoints, and was stopped'),
    );
    expect(
      await ended(answering('const kept: string[] = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);')),
    ).toEqual(
      unworkable(
        'The answer used more memory than a run may, the 256 MiB of its sandbox, having done 0 checkpoints of work',
      ),
    );
  });

  it('ends in conflict when the stack of its worker overflows before its own', async () => {
    const overflowing: PoolOutcome = {
      ran: 'exhausted',
      limit: 'stack',
      issue: { detail: 'The program went deeper than the stack it runs on allows', line: null },
      work: 10,
      milliseconds: 5,
    };
    const run = recallWith(scriptedPool([overflowing], poolOf()));
    run.keep(liveView({}));

    expect(await run.running(answering('return view;'))).toEqual(
      unworkable('The answer went deeper than the 1 MiB stack of a run allows'),
    );
    expect(await run.running(answering('return view;'))).toMatchObject(Exit.succeed({ output: {} }));
  });
});

describe('a run whose answer the server cannot finish', { timeout: workerTestTimeoutMs }, () => {
  it('is unavailable when it runs past its deadline', async () => {
    const slow = recallWith(poolOf(), 300);
    slow.keep(liveView({}));

    expect(
      await slow.running(answering('const big = ["x".repeat(4000000)];\n  for (;;) JSON.stringify(big);')),
    ).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The answer took longer than the 300 ms a recall function may run, and was stopped',
        }),
      ),
    );
  });
});

describe('a run whose answer the pool stops', { timeout: workerTestTimeoutMs }, () => {
  it.each(stoppedWhen)('is unavailable when the pool answers %j', async (outcome, detail) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));

    expect(await run.running(answering('return view;'))).toEqual(Exit.fail(new Unavailable({ detail })));
  });

  it.each(brokenWhen)('fails, as the server breaks, when the pool answers %j', async (outcome, defect) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));
    const exit = await run.running(answering('return view;'));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});

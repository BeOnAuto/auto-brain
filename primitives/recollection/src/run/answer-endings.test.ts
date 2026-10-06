import { Conflict, Unavailable } from '@beonauto/operations';
import type { PoolOutcome } from '@beonauto/workflow-engine/dsl';
import { Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith, workerTestTimeoutMs } from '../testing/recall-runs.ts';
import { scriptedPool } from '../testing/scripted-pool.ts';

const succeeded = 'language: jq\nsource:\n  events:\n    - type: execution_succeeded';

function unworkable(detail: string): Exit.Exit<never, Conflict> {
  return Exit.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function answering(answer: string, more = ''): string {
  return recallDocument('.', `${succeeded}\nanswer: '${answer}'${more}`);
}

const springWithoutReviews = { spring: [] };

const noInput = {};

function ended(source: string, view: Schema.Json = springWithoutReviews, input: Schema.Json = noInput) {
  const run = recallWith();
  run.keep(liveView(view));
  return run.executing(source, input);
}

describe('a run whose answer cannot work as written', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict, unworkable, with the error the answer raised and its line in the document', async () => {
    expect(await ended(answering('error("no campaign \\(.spring | length)")'))).toEqual(
      unworkable('The answer raised an error on line 6: no campaign 0'),
    );
    expect(await ended(answering('.spring + 1'))).toEqual(
      unworkable('The answer raised an error on line 6: Cannot add array and number'),
    );
  });

  it('ends in conflict when the answer gives no output, or more than one', async () => {
    expect(await ended(answering('empty'))).toEqual(
      unworkable('The answer gave no output; a recall function gives exactly one'),
    );
    expect(await ended(answering('(., .)'))).toEqual(
      unworkable('The answer gave more than one output; a recall function gives exactly one'),
    );
  });

  it('ends in conflict when its answer, or the view it answers, is not what the output schema allows, checked in the worker', async () => {
    expect(await ended(campaignReviews, { spring: [1] }, { campaign: 'spring' })).toEqual(
      unworkable('The answer does not match the output schema: /0: Expected object'),
    );
    expect(await ended(recallDocument('.', `${succeeded}\noutput: {schema: {type: array}}`), { spring: [] })).toEqual(
      unworkable('The view does not match the output schema: the output: Expected array'),
    );
    expect(
      await ended(recallDocument('.', `${succeeded}\noutput: {schema: {properties: {spring: {type: string}}}}`)),
    ).toEqual(unworkable('The view does not match the output schema: /spring: Expected string'));
    expect(await ended(answering('[.spring]', '\noutput: {schema: {type: object}}'))).toEqual(
      unworkable('The answer does not match the output schema: the output: Expected object'),
    );
  });

  it('ends in conflict when its answer is not JSON, or takes more than a run can record beside its record', async () => {
    expect(await ended(answering('nan'))).toEqual(
      unworkable('The answer gave a number JSON cannot carry, such as nan or infinite'),
    );
    expect(await ended(answering('"x" * 1100000'))).toEqual(
      unworkable('The answer takes more than the 1046528 bytes as JSON a run can record'),
    );
  });
});

describe('a run whose answer reaches a bound', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict when it does more than 16,000,000 units of work, with the units it spent', async () => {
    expect(await ended(answering('"x" * 20000000'))).toEqual(
      unworkable('The answer did more than the 16000000 units of work a run may do, on line 6, having done 20000417'),
    );
  });

  it('ends in conflict when it builds a value nested deeper than 512 levels, or recurses past its fixed bound', async () => {
    expect(await ended(answering('reduce range(600) as $i (null; [.])'))).toEqual(
      unworkable('The answer built a value that nests deeper than the 512 levels a value may, on line 6'),
    );
    expect(await ended(answering('def g: if . == 0 then 0 else (. - 1 | g) end; 3000 | g'))).toEqual(
      unworkable('The answer recursed deeper than the 10000 levels of evaluation a run may nest, on line 6'),
    );
  });

  it('ends in conflict when the stack of its worker overflows', async () => {
    const overflowing: PoolOutcome = {
      ran: 'exhausted',
      limit: 'stack',
      issue: { detail: 'Maximum call stack size exceeded', span: { start: 0, end: 0 }, error: 'RangeError' },
      work: 10,
      milliseconds: 5,
    };
    const run = recallWith(scriptedPool([overflowing], poolOf()));
    run.keep(liveView({}));

    expect(await run.executing(answering('.'))).toEqual(
      unworkable('The answer went deeper than the 64 MiB stack of a run allows'),
    );
    expect(await run.executing(answering('.'))).toMatchObject(Exit.succeed({ output: {} }));
  });
});

describe('a run whose answer the server cannot finish', { timeout: workerTestTimeoutMs }, () => {
  it('is unavailable when it runs past its deadline', async () => {
    const slow = recallWith(poolOf(), 50);
    slow.keep(liveView({}));

    expect(await slow.executing(answering('[range(100000000)] | length'))).toEqual(
      Exit.fail(
        new Unavailable({ detail: 'The answer took longer than the 50 ms a recall function may run, and was stopped' }),
      ),
    );
  });
});

describe('a run whose answer the pool stops', { timeout: workerTestTimeoutMs }, () => {
  it.each<readonly [PoolOutcome, string]>([
    [
      { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
      'No worker was free to answer within 10000 ms; this server runs 2 programs at once',
    ],
    [
      { ran: 'stopped', because: 'memory', milliseconds: 10 },
      'The answer took more than the 256 MiB of memory a recall function may use, and was stopped',
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
        issue: { detail: 'Deadline exceeded', span: { start: 0, end: 0 } },
        work: 5,
        milliseconds: 10_000,
      },
      'The answer took longer than the 10000 ms a recall function may run, and was stopped',
    ],
  ])('is unavailable when the pool answers %j', async (outcome, detail) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));

    expect(await run.executing(answering('.'))).toEqual(Exit.fail(new Unavailable({ detail })));
  });

  it.each<readonly [PoolOutcome, string]>([
    [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
    [{ ran: 'refused', issues: [], milliseconds: 1 }, 'The worker refused an answer the definition was accepted with'],
  ])('fails, as the server breaks, when the pool answers %j', async (outcome, defect) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));
    const exit = await run.executing(answering('.'));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});

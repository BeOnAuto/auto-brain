import { Unavailable } from '@beonauto/operations';
import { programPool, type CheckOutcome, type CheckJob, type ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect, Exit } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import * as checkWorkerModule from './check-worker.ts';
import { checkDeadlineMs, checkedAtSave, checkWorker } from './save-check.ts';

const pool = programPool({ workers: 1, heapMegabytes: 256 });

afterAll(() => pool.close());

const job: CheckJob = {
  module: { place: 'computation', source: 'export default function (input: Input): Output {\n  return input.redy;\n}' },
  schemas: { input: { type: 'object', required: ['ready'], properties: { ready: { type: 'boolean' } } } },
  expressions: [{ source: '$data.ready', names: ['$data'] }],
};

const brokenWhen: readonly (readonly [CheckOutcome, string])[] = [
  [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
  [{ ran: 'unreadable', milliseconds: 1 }, 'The check worker could not read the check it was given'],
];

function answering(outcome: CheckOutcome): ProgramPool {
  return { ...pool, check: () => Promise.resolve(outcome) };
}

function checked(on: ProgramPool, deadlineMs?: number) {
  return Effect.runPromiseExit(checkedAtSave(on, job, deadlineMs));
}

describe('the check of a document when it is saved', () => {
  it('runs in the pool’s check worker and answers the compiler’s issues', { timeout: 60_000 }, async () => {
    expect(await checked(pool, 50_000)).toEqual(
      Exit.succeed([
        {
          at: 'module',
          line: 2,
          detail: "Property 'redy' does not exist on type 'Input'. Did you mean 'ready'?",
        },
      ]),
    );
    expect(checkDeadlineMs).toBe(2000);
    expect(checkWorker.pathname).toMatch(/\/program-check\/check-worker\.ts$/u);
    expect(Object.keys(checkWorkerModule)).toEqual([]);
  });
});

describe('a check that does not answer', () => {
  it('is unavailable when the check does not answer within its deadline', async () => {
    expect(await checked(pool, 1)).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'The check of the document did not answer within the 1 ms a save allows it, and was stopped; try again',
        }),
      ),
    );
  });

  it('is unavailable, with what stopped it, when the pool stops the check', async () => {
    const stopped = await Promise.all(
      (['busy', 'memory', 'cancelled', 'closing'] as const).map((because) =>
        checked(answering({ ran: 'stopped', because, milliseconds: 1 })),
      ),
    );

    expect(stopped).toEqual(
      [
        'No checker was free within the 2000 ms a save allows its check, since this server checks one document at a time; try again',
        'The check of the document took more memory than its worker may use, and was stopped; try again',
        'The save was stopped before its check ended',
        'The server is stopping',
      ].map((detail) => Exit.fail(new Unavailable({ detail }))),
    );
  });

  it.each(brokenWhen)('breaks down when the pool answers %j', async (outcome, defect) => {
    const exit = await checked(answering(outcome));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});

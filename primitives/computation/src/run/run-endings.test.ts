import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import type { PoolOutcome } from '@beonauto/workflow-engine/dsl';
import { Exit, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { computationWith, poolOf, programDocument, workerTestTimeoutMs } from '../testing/computation-runs.ts';
import { scriptedPool } from '../testing/scripted-pool.ts';

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Json, record: Schema.Struct({ work: Schema.Number }) }),
);

function unworkable(detail: string): Exit.Exit<never, Conflict> {
  return Exit.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function ended(program: string, frontMatter?: string) {
  return computationWith().executing(programDocument(program, frontMatter), null);
}

describe('a run whose program cannot work as written', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict, unworkable, with the error the program raised and its line in the document', async () => {
    expect(await ended('[1, 2, 3]\n| map(. * 2)\n| error("stopped at \\(length)")')).toEqual(
      unworkable('The program raised an error on line 6: stopped at 3'),
    );
    expect(await ended('"x" + 1')).toEqual(
      unworkable('The program raised an error on line 4: Cannot add string and number'),
    );
  });

  it('ends in conflict when the program gives no output, or more than one', async () => {
    expect(await ended('empty')).toEqual(
      unworkable('The program gave no output; a computation function gives exactly one'),
    );
    expect(await ended('1, 2')).toEqual(
      unworkable('The program gave more than one output; a computation function gives exactly one'),
    );
  });

  it('ends in conflict when its output is not what the output schema allows, or not JSON', async () => {
    expect(await ended('{total: 1}', 'language: jq\noutput: {schema: {type: object, required: [rows]}}')).toEqual(
      unworkable("The program's output does not match the output schema: /rows: Missing key"),
    );
    expect(await ended('1', 'language: jq\noutput: {schema: {type: string}}')).toEqual(
      unworkable("The program's output does not match the output schema: the output: Expected string"),
    );
    expect(await ended('nan')).toEqual(
      unworkable('The program gave a number JSON cannot carry, such as nan or infinite'),
    );
  });

  it('ends in conflict when its output takes more than a run can record', async () => {
    expect(await ended('"x" * 1100000')).toEqual(
      unworkable("The program's output takes more than the 1048320 bytes as JSON a run can record"),
    );
  });

  it('measures an output before writing it, so one that would take 240 MB as JSON ends in conflict and the pool runs on', async () => {
    const run = computationWith();

    expect(await run.executing(programDocument('("\\u0001Ā" * 15000000) | [., .]'), null)).toEqual(
      unworkable("The program's output takes more than the 1048320 bytes as JSON a run can record"),
    );
    expect(await run.executing(programDocument('. + 1'), 1)).toMatchObject(Exit.succeed({ output: 2 }));
  });
});

describe('the text of a long error', { timeout: workerTestTimeoutMs }, () => {
  it('cuts the text of the error, and each issue of an output the schema refuses, at 1,024 bytes', async () => {
    const longKey = 'language: jq\noutput: {schema: {type: object, additionalProperties: false}}';
    const refused = await ended('{("k" * 500000): 1}', longKey);
    const detailOf = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.String }));

    expect(await ended('error("x" * 30000000)')).toEqual(
      unworkable(`The program raised an error on line 4: ${'x'.repeat(1024)}…`),
    );
    expect(Exit.isFailure(refused)).toBe(true);
    const detail = detailOf(Option.getOrThrow(Exit.findErrorOption(refused))).detail;

    expect(detail.startsWith("The program's output does not match the output schema: /kkkk")).toBe(true);
    expect(detail.endsWith('…')).toBe(true);
    expect(detail.length).toBeLessThan(1200);
  });
});

describe('a run that reaches a bound of its program', { timeout: workerTestTimeoutMs }, () => {
  it('ends in conflict when it does more than 64,000,000 units of work, with the units it spent', async () => {
    const hashing = '("a" * 4000000) as $s | {} as $o | reduce range(1000) as $i (0; . + ($o[$s + "x"] // 1))';

    expect(await ended('"x" * 100000000')).toEqual(
      unworkable('The program did more than the 64000000 units of work a run may do, on line 4, having done 100000417'),
    );
    const unitsSpent: unknown = expect.stringMatching(/^The program did more than the 64000000 units/u);

    expect(await ended(hashing)).toMatchObject(Exit.fail({ kind: 'unworkable', detail: unitsSpent }));
  });

  it('ends in conflict when a regular expression would compile to more than it may, as the program raised', async () => {
    expect(await ended('"a" | test("(((a{100}){100}){100}){40}")')).toEqual(
      unworkable('The program raised an error on line 4: regex too large: more than 4096 instructions'),
    );
  });

  it('ends in conflict when it builds a value nested deeper than 512 levels, a value of 100,000 levels among them', async () => {
    expect(await ended('("[" * 100000) + ("]" * 100000) | fromjson')).toEqual(
      unworkable('The program built a value that nests deeper than the 512 levels a value may, on line 4'),
    );
    expect(await ended('reduce range(600) as $i (null; [.])')).toEqual(
      unworkable('The program built a value that nests deeper than the 512 levels a value may, on line 4'),
    );
  });

  it('ends in conflict when it recurses deeper than its fixed bound, the same on every host', async () => {
    const recursion = 'def g: if . == 0 then 0 else (. - 1 | g) end; g';
    const run = computationWith();

    expect(await run.executing(programDocument(recursion), 500)).toMatchObject(Exit.succeed({ output: 0 }));
    expect(await run.executing(programDocument(recursion), 3000)).toEqual(
      unworkable('The program recursed deeper than the 10000 levels of evaluation a run may nest, on line 4'),
    );
  });
});

describe('a run of the server that cannot finish', { timeout: workerTestTimeoutMs }, () => {
  it('is unavailable when it runs past its deadline', async () => {
    const slow = computationWith(poolOf(), 50);

    expect(await slow.executing(programDocument('[range(100000000)] | length'), null)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The run took longer than the 50 ms a computation function may run, and was stopped',
        }),
      ),
    );
  });

  it('is unavailable when it takes more memory than its worker has', async () => {
    const small = computationWith(poolOf({ heapMegabytes: 16 }));

    expect(await small.executing(programDocument('[range(1000000) | {a: .}] | length'), null)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The run took more than the 256 MiB of memory a computation function may use, and was stopped',
        }),
      ),
    );
  });
});

describe('a run that the pool stops', { timeout: workerTestTimeoutMs }, () => {
  it.each<readonly [PoolOutcome, string]>([
    [
      { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
      'No worker was free to run it within 10000 ms; this server runs 4 computation functions at once',
    ],
    [
      { ran: 'stopped', because: 'deadline', milliseconds: 10_000 },
      'The run took longer than the 10000 ms a computation function may run, and was stopped',
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
      'The run took longer than the 10000 ms a computation function may run, and was stopped',
    ],
  ])('is unavailable when the pool answers %j', async (outcome, detail) => {
    const run = computationWith(scriptedPool([outcome], poolOf()));

    expect(await run.executing(programDocument('.'), null)).toEqual(Exit.fail(new Unavailable({ detail })));
  });

  it.each<readonly [PoolOutcome, string]>([
    [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
    [{ ran: 'refused', issues: [], milliseconds: 1 }, 'The worker refused a program the definition was accepted with'],
  ])('fails, as the server breaks, when the pool answers %j', async (outcome, defect) => {
    const run = computationWith(scriptedPool([outcome], poolOf()));
    const exit = await run.executing(programDocument('.'), null);

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});

describe('a run that was unavailable', { timeout: workerTestTimeoutMs }, () => {
  it('runs when it is tried again, since nothing in it changed', async () => {
    const run = computationWith(scriptedPool([{ ran: 'stopped', because: 'busy', milliseconds: 10_000 }], poolOf()));

    expect(await run.executing(programDocument('. + 1'), 1)).toMatchObject(Exit.fail({ _tag: 'unavailable' }));
    expect(await run.executing(programDocument('. + 1'), 1)).toMatchObject(Exit.succeed({ output: 2 }));
  });
});

describe('the input of a run', { timeout: workerTestTimeoutMs }, () => {
  it('is checked against the input schema, with a pointer to what does not fit', async () => {
    expect(
      await computationWith().executing(campaignPace, {
        period: { days_elapsed: 12, days_total: 31 },
        rows: [{ campaign: 'a', cost_cents: 'ten', budget_cents: 1 }],
      }),
    ).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input does not match the computation function’s input schema',
          issues: [{ pointer: '/rows/0/cost_cents', detail: 'Expected number' }],
        }),
      ),
    );
  });

  it('nests at most 512 levels', async () => {
    const deep = Array.from({ length: 600 }).reduce<Schema.Json>((inner) => [inner], null);

    expect(await computationWith().executing(programDocument('.'), deep)).toMatchObject(
      Exit.fail({
        _tag: 'invalid_input',
        detail: 'The input nests more than the 512 levels a computation function takes',
      }),
    );
  });
});

describe('the output of a run', { timeout: workerTestTimeoutMs }, () => {
  it('is the same for the same input, in two pools of workers', async () => {
    const input = campaignRows(300);

    const [first, second] = await Promise.all(
      [poolOf(), poolOf()].map(async (pool) =>
        decodeRun(Option.getOrThrow(Exit.getSuccess(await computationWith(pool).executing(campaignPace, input)))),
      ),
    );

    expect(first?.output).toEqual(second?.output);
    expect(first?.record.work).toBe(second?.record.work);
  });
});

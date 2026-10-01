import { Conflict, type Decider } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { journal, type JournalEvent } from './testing/journal.ts';
import { openLedger, outcomeOf, type OpenLedger } from './testing/open-ledger.ts';
import { tally } from './testing/tally.ts';

const opened: OpenLedger[] = [];

async function aLedger(): Promise<OpenLedger['ledger']> {
  const open = await openLedger();
  opened.push(open);
  return open.ledger;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(({ dispose }) => dispose()));
});

const tallies = 'org/acme/tallies';

function ones(count: number): readonly number[] {
  return Array.from({ length: count }, () => 1);
}

describe('loading a stream', () => {
  it('gives the initial state at version 0 for a stream nobody wrote', async () => {
    const ledger = await aLedger();

    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 0 });
  });
});

describe('executing a command', () => {
  it('appends the decided events and answers with the folded state and the version after them', async () => {
    const ledger = await aLedger();

    expect(await Effect.runPromise(ledger.execute(tallies, tally, [2, 3]))).toEqual({ state: 5, version: 2 });
    expect(await Effect.runPromise(ledger.execute(tallies, tally, [4]))).toEqual({ state: 9, version: 3 });
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 9, version: 3 });
  });

  it('answers a refusal as the failure it is and appends nothing', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(ledger.execute(tallies, tally, [5]));

    expect(await outcomeOf(ledger.execute(tallies, tally, [-6]))).toEqual(
      Result.fail(new Conflict({ detail: 'A tally of 5 cannot fall to -1' })),
    );
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 5, version: 1 });
  });

  it('appends nothing for a decision of no events and answers with the current state and version', async () => {
    const ledger = await aLedger();
    await Effect.runPromise(ledger.execute(tallies, tally, [1]));

    expect(await Effect.runPromise(ledger.execute(tallies, tally, []))).toEqual({ state: 1, version: 1 });
    expect(await Effect.runPromise(ledger.execute('org/acme/untouched', tally, []))).toEqual({ state: 0, version: 0 });
    expect(await Effect.runPromise(ledger.execute('org/acme/untouched', tally, [7]))).toEqual({ state: 7, version: 1 });
  });
});

describe('the size of a decision', () => {
  it('may be up to eight events, appended at once', async () => {
    const ledger = await aLedger();

    expect(await Effect.runPromise(ledger.execute(tallies, tally, ones(8)))).toEqual({ state: 8, version: 8 });
  });

  it('is a defect beyond eight events, and nothing is appended', async () => {
    const ledger = await aLedger();

    await expect(outcomeOf(ledger.execute(tallies, tally, ones(9)))).rejects.toThrow(
      'A decision on org/acme/tallies gave 9 events, more than 8',
    );
    expect(await Effect.runPromise(ledger.load(tallies, tally))).toEqual({ state: 0, version: 0 });
  });
});

describe('the events of a stream', () => {
  it('come back exactly as they were decided, through the JSON encoding of their schema', async () => {
    const ledger = await aLedger();
    const decided: readonly JournalEvent[] = [
      {
        type: 'entry_written',
        at: new Date('2026-09-30T23:59:59.999Z'),
        amount: 12_345_678_901_234_567_890n,
        ratio: Number.NaN,
        tags: [],
        source: null,
      },
      {
        type: 'entry_written',
        at: new Date(0),
        amount: -1n,
        ratio: Number.NEGATIVE_INFINITY,
        tags: ['quarter-end', 'café', '"quoted"', 'line\nbreak'],
        memo: 'Tab\there, emoji 🧾, and a backslash \\',
        source: { name: 'Ledger of record' },
      },
      { type: 'entry_struck', reason: 'Written twice' },
    ];

    await Effect.runPromise(ledger.execute('brain/acme/sales/journal', journal, decided));

    expect(await Effect.runPromise(ledger.load('brain/acme/sales/journal', journal))).toEqual({
      state: decided,
      version: 3,
    });
  });

  it('are a defect, not a refusal, when a stored event no longer decodes', async () => {
    const ledger = await aLedger();
    const TextualCountedSchema = Schema.Struct({ type: Schema.Literal('counted'), by: Schema.String });
    const talliedAsText: Decider<string, string, typeof TextualCountedSchema.Type> = {
      initialState: '',
      evolve: (text, { by }) => `${text}${by}`,
      decide: (by) => Result.succeed([{ type: 'counted', by }]),
      eventSchema: TextualCountedSchema,
    };
    await Effect.runPromise(ledger.execute(tallies, tally, [3]));

    await expect(outcomeOf(ledger.load(tallies, talliedAsText))).rejects.toThrow('Expected string\n  at ["by"]');
    await expect(outcomeOf(ledger.execute(tallies, talliedAsText, 'more'))).rejects.toThrow(
      'Expected string\n  at ["by"]',
    );
  });
});

describe('stream names', () => {
  it('are kept exactly as given, so names that differ only in case, punctuation or Unicode form are different streams', async () => {
    const ledger = await aLedger();
    const names = [
      'org/acme/brains',
      'org/Acme/brains',
      'org/ACME/brains',
      'org/acme-corp/brains',
      'org/acme_corp/brains',
      'org/acme/brains/',
      'org/acme//brains',
      ' org/acme/brains',
      'org/acme-x',
      'org/acme-y',
      'brain/acme/sales/specs/inference',
      'brain/acme/sales-specs/inference',
      'brain/acme/sales_specs/inference',
      'org/café/brains'.normalize('NFC'),
      'org/café/brains'.normalize('NFD'),
    ];

    const written = await Effect.runPromise(
      Effect.forEach(names, (name, index) => ledger.execute(name, tally, [index + 1])),
    );
    const loaded = await Effect.runPromise(Effect.forEach(names, (name) => ledger.load(name, tally)));

    const expected = Array.from(names.keys(), (index) => ({ state: index + 1, version: 1 }));
    expect(written).toEqual(expected);
    expect(loaded).toEqual(expected);
  });
});

import { cursorWithin, messageIdOf, type Lineage, type RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  details,
  happenings,
  inAlpha,
  noted,
  reading,
  type AnyLedger,
  type LedgerMaker,
} from '../testing/happenings.ts';

function happenWith(ledger: AnyLedger, stream: string, lineage: Lineage, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, happenings, [noted('noted', detail)], lineage));
}

function lineagesOf(records: readonly RecordedEvent[]): readonly (Lineage & { readonly id: string })[] {
  return records.map(({ id, causationId, correlationId }) => ({ id, causationId, correlationId }));
}

const root = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const child = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

function idsOfARead(aLedger: LedgerMaker): void {
  describe('the lineage of what a brain recorded', () => {
    it('names each message by its stream and position, with the cause and correlation it was written with', async () => {
      const ledger = await aLedger();
      await happenWith(ledger, inAlpha(`executions/${root}`), { causationId: null, correlationId: root }, 'start');
      const start = messageIdOf(inAlpha(`executions/${root}`), 1);
      await happenWith(ledger, inAlpha(`runs/${root}`), { causationId: start, correlationId: root }, 'input');
      await Effect.runPromise(ledger.execute(inAlpha('specs/inference'), happenings, [noted('noted', 'spec')]));

      const { records } = await reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10 });

      expect(lineagesOf(records)).toEqual([
        { id: start, causationId: null, correlationId: root },
        { id: messageIdOf(inAlpha(`runs/${root}`), 1), causationId: start, correlationId: root },
        { id: messageIdOf(inAlpha('specs/inference'), 1), causationId: null, correlationId: null },
      ]);
    });
  });
}

function aReadByCorrelation(aLedger: LedgerMaker): void {
  describe('a read by correlation', () => {
    it('answers what a run and the runs it caused recorded, in the order of the brain, and nothing for a child', async () => {
      const ledger = await aLedger();
      const ofRoot = { causationId: null, correlationId: root };
      await happenWith(ledger, inAlpha(`executions/${root}`), ofRoot, 'root started');
      await happenWith(ledger, inAlpha('notes'), { causationId: null, correlationId: null }, 'elsewhere');
      await happenWith(ledger, inAlpha(`executions/${child}`), ofRoot, 'child started');
      await happenWith(ledger, 'brain/acme/beta/notes', ofRoot, 'another brain');
      await happenWith(ledger, inAlpha(`executions/${root}`), ofRoot, 'root finished');

      const pages = await Promise.all([
        reading(ledger, { kind: 'correlated', correlation: root }, { order: 'asc', limit: 2 }),
        reading(ledger, { kind: 'correlated', correlation: root }, { order: 'desc', limit: 10 }),
        reading(ledger, { kind: 'correlated', correlation: child }, { order: 'asc', limit: 10 }),
      ]);
      const rest = await reading(
        ledger,
        { kind: 'correlated', correlation: root },
        { order: 'asc', limit: 2, cursor: String(pages[0].nextCursor) },
      );

      expect([...pages, rest].map((page) => details(page))).toEqual([
        ['root started', 'child started'],
        ['root finished', 'child started', 'root started'],
        [],
        ['root finished'],
      ]);
    });
  });
}

function aReadFromInsideARecord(aLedger: LedgerMaker): void {
  describe('a read from a cursor inside a record', () => {
    it('begins with that record, in either order', async () => {
      const ledger = await aLedger();
      await Effect.runPromise(
        ledger.execute(inAlpha('notes'), happenings, [noted('noted', 1), noted('noted', 2), noted('noted', 3)]),
      );
      const { records } = await reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10 });
      const cursor = cursorWithin(String(records[1]?.cursor), 4);

      const pages = await Promise.all([
        reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10, cursor }),
        reading(ledger, { kind: 'everything' }, { order: 'desc', limit: 10, cursor }),
      ]);

      expect(pages.map((page) => details(page))).toEqual([
        [2, 3],
        [2, 1],
      ]);
    });
  });
}

export function lineageBehaviour(aLedger: LedgerMaker): void {
  idsOfARead(aLedger);
  aReadByCorrelation(aLedger);
  aReadFromInsideARecord(aLedger);
}

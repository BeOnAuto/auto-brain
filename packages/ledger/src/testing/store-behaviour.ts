import { messageIdOf } from '@beonauto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../event-appender.ts';
import type { RecordedPoint, RecordedStream } from '../event-store.ts';
import { VersionConflict } from '../version-conflict.ts';
import { journal } from './journal.ts';
import { aLedger, aStore, tallies, type LedgerEntry } from './ledger-entry.ts';
import { openLedgerWith, outcomeOf } from './open-ledger.ts';
import { tally, tallyInterruptedBy } from './tally.ts';

const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function numbered(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ type: 'counted', data: { n: from + index } }));
}

const three = [{ type: 'counted' as const, by: 3 }];

async function eventsOf(reading: Promise<RecordedStream>): Promise<Omit<RecordedStream, 'lineages'>> {
  const { version, events } = await reading;
  return { version, events };
}

function readingAfterAVersion(entry: LedgerEntry): void {
  describe('reading a stream after a version', () => {
    it('gives the events after that version, and the version of the whole stream', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 3), 0);
      await store.append(run, numbered(4, 2), 3);

      expect(await eventsOf(store.read(run, 3))).toEqual({ version: 5, events: [{ n: 4 }, { n: 5 }] });
      expect(await eventsOf(store.read(run))).toEqual({ version: 5, events: [1, 2, 3, 4, 5].map((n) => ({ n })) });
    });

    it('gives no events and the version it was asked after when nothing follows it', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 3), 0);

      expect(await eventsOf(store.read(run, 3))).toEqual({ version: 3, events: [] });
      expect(await eventsOf(store.read('run/nobody-wrote', 0))).toEqual({ version: 0, events: [] });
    });
  });
}

function theLineageOfEachMessage(entry: LedgerEntry): void {
  describe('the lineage of each message', () => {
    it('names it by its stream and position, and keeps the cause and correlation it was appended with', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 2), 0);
      await eventAppenderOf(store, tally.eventSchema)(run, three, 2, {
        causationId: 'cause',
        correlationId: 'root',
      }).pipe(Effect.runPromise);

      expect((await store.read(run)).lineages).toEqual([
        { id: messageIdOf(run, 1), causationId: null, correlationId: null },
        { id: messageIdOf(run, 2), causationId: null, correlationId: null },
        { id: messageIdOf(run, 3), causationId: 'cause', correlationId: 'root' },
      ]);
    });
  });
}

function orderOf(point: RecordedPoint): bigint {
  return point.reduce((order, part) => (order << 64n) + BigInt(part), 0n);
}

async function aStoreAndItsDatabase(entry: LedgerEntry) {
  const database = await entry.aDatabase();
  const store = entry.storeOn(database);
  onTestFinished(() => store.close());
  await store.migrate();
  return { store, readable: () => entry.untilReadable(database) };
}

function readingWhatWasAppended(entry: LedgerEntry): void {
  describe('reading which streams were appended to after a point', () => {
    it('names each kind of stream of a brain once, and each stream outside a brain, appended to after the point', async () => {
      const { store, readable } = await aStoreAndItsDatabase(entry);
      await store.append('org/acme/brains', numbered(1, 1), 0);
      await readable();
      const before = await store.readAppended(undefined, 100);
      await store.append('brain/acme/alpha/events/e1', numbered(1, 1), 0);
      await store.append('brain/acme/alpha/events/e2', numbered(1, 2), 0);
      await store.append('brain/acme/alpha/runs/r1', numbered(1, 1), 0);
      await store.append('org/acme/brains', numbered(2, 1), 1);
      await readable();

      const appended = await store.readAppended(before.through, 100);
      const nothingSince = await store.readAppended(appended.through, 100);

      expect(appended.streams.toSorted()).toEqual([
        'brain/acme/alpha/events/',
        'brain/acme/alpha/runs/',
        'org/acme/brains',
      ]);
      expect(appended.more).toBe(false);
      expect([nothingSince.streams, nothingSince.more]).toEqual([[], false]);
      expect(nothingSince.through).toHaveLength(appended.through.length);
      expect(orderOf(nothingSince.through) >= orderOf(appended.through)).toBe(true);
    });

    it('reads at most as many messages as it is asked, and the next read goes on after the last it read', async () => {
      const { store, readable } = await aStoreAndItsDatabase(entry);
      await readable();
      const before = await store.readAppended(undefined, 100);
      await store.append('brain/acme/alpha/events/e1', numbered(1, 1), 0);
      await store.append('brain/acme/beta/events/e1', numbered(1, 1), 0);
      await store.append('brain/acme/gamma/events/e1', numbered(1, 1), 0);
      await readable();

      const first = await store.readAppended(before.through, 2);
      const next = await store.readAppended(first.through, 2);

      expect([first.streams.toSorted(), first.more]).toEqual([
        ['brain/acme/alpha/events/', 'brain/acme/beta/events/'],
        true,
      ]);
      expect([next.streams, next.more]).toEqual([['brain/acme/gamma/events/'], false]);
    });
  });
}

function appendingWithAnExpectedVersion(entry: LedgerEntry): void {
  describe('appending with an expected version', () => {
    it.each([0, 1, 3])(
      'meets a version conflict and appends nothing when it expects %i of a stream at version 2',
      async (expected) => {
        const store = await aStore(entry);
        await store.append(run, numbered(1, 2), 0);

        expect(await outcomeOf(eventAppenderOf(store, tally.eventSchema)(run, three, expected))).toEqual(
          Result.fail(new VersionConflict()),
        );
        expect(await eventsOf(store.read(run))).toEqual({ version: 2, events: [{ n: 1 }, { n: 2 }] });
      },
    );

    it('meets a version conflict when it expects a version of a stream nobody wrote', async () => {
      const store = await aStore(entry);

      expect(await outcomeOf(eventAppenderOf(store, tally.eventSchema)(run, three, 1))).toEqual(
        Result.fail(new VersionConflict()),
      );
      expect(await eventsOf(store.read(run))).toEqual({ version: 0, events: [] });
    });

    it('keeps the same event appended twice as two events', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 1), 0);
      await store.append(run, numbered(1, 1), 1);

      expect(await eventsOf(store.read(run))).toEqual({ version: 2, events: [{ n: 1 }, { n: 1 }] });
    });
  });
}

function closedAndOpenedAgain(entry: LedgerEntry): void {
  describe('a ledger closed and opened again', () => {
    it('keeps what was written and goes on from there', async () => {
      const database = await entry.aDatabase();
      const first = await openLedgerWith(entry.ledgerOn(database));
      await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
      await Effect.runPromise(
        first.ledger.execute('brain/acme/sales/journal', journal, [{ type: 'entry_struck', reason: 'Duplicate' }]),
      );
      await first.dispose();

      const second = await aLedger(entry, database);
      const reloaded = await Effect.runPromise(
        Effect.all([second.load(tallies, tally), second.load('brain/acme/sales/journal', journal)]),
      );
      const continued = await Effect.runPromise(second.execute(tallies, tally, [4]));

      expect(reloaded).toEqual([
        { state: 5, version: 2 },
        { state: [{ type: 'entry_struck', reason: 'Duplicate' }], version: 1 },
      ]);
      expect(continued).toEqual({ state: 9, version: 3 });
    });
  });
}

function whoseDatabaseIsGone(entry: LedgerEntry): void {
  describe('a ledger whose database is gone', () => {
    it('answers every call after disposal with a defect', async () => {
      const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(await entry.aDatabase()));
      await dispose();

      await expect(outcomeOf(ledger.load(tallies, tally))).rejects.toThrow(entry.afterClosing);
      await expect(outcomeOf(ledger.execute(tallies, tally, [1]))).rejects.toThrow(entry.afterClosing);
    });

    it('turns a write that fails for a reason other than a version conflict into a defect', async () => {
      const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(await entry.aDatabase()));
      const closeTheDatabaseFirst = Effect.promise(dispose);

      await expect(
        outcomeOf(ledger.execute(tallies, tallyInterruptedBy(closeTheDatabaseFirst, 1), [1])),
      ).rejects.toThrow(entry.closedWhileWriting);
    });
  });
}

export function storeBehaviour(entry: LedgerEntry): void {
  readingAfterAVersion(entry);
  theLineageOfEachMessage(entry);
  readingWhatWasAppended(entry);
  appendingWithAnExpectedVersion(entry);
  closedAndOpenedAgain(entry);
  whoseDatabaseIsGone(entry);
}

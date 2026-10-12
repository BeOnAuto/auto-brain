import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import { filterTestingOf, filterVerdictsOf, type FilterSandbox } from './filter-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const filling = '${ (() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })() }';

interface CountedSandbox {
  readonly sandbox: FilterSandbox;
  readonly opened: () => number;
  readonly closed: () => number;
}

function closedIn(region: string): JsonObject {
  return { type: 'com.acme.ledger.month-closed', data: { region } };
}

function filterAt(reference: string, data: string) {
  return { reference, attributes: { type: 'com.acme.ledger.month-closed', data } };
}

function counted(sandbox: FilterSandbox): CountedSandbox {
  const counts = { opened: 0, closed: 0 };
  return {
    sandbox: {
      ...sandbox,
      session: async (opening) => {
        counts.opened += 1;
        const session = await sandbox.session(opening);
        return {
          ...session,
          close: () => {
            counts.closed += 1;
            session.close();
          },
        };
      },
    },
    opened: () => counts.opened,
    closed: () => counts.closed,
  };
}

const european = filterAt('/eu', '${ $data.region == "eu" }');

const american = filterAt('/us', '${ $data.region == "us" }');

describe('the filters tested over a page of events', () => {
  it('prepare their tests in one session and test every event in it, answering as a group of each event alone does', async () => {
    const counting = counted(filterSandboxOf(() => 0));
    const testing = filterTestingOf([european, american], counting.sandbox);

    const verdicts = [
      await testing.verdictsOf(closedIn('eu'), now),
      await testing.verdictsOf(closedIn('us'), now),
      await testing.verdictsOf(closedIn('apac'), now),
    ];
    const sessionsOfThePage = counting.opened();
    testing.close();
    testing.close();

    expect(verdicts).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect([sessionsOfThePage, counting.closed()]).toEqual([1, 1]);
    expect(verdicts[0]).toEqual(await filterVerdictsOf([european, american], closedIn('eu'), filterSandboxOf(), now));
  });

  it('let a session the sandbox stopped go, finish the event in sessions of its own, and test the next event in a fresh one', async () => {
    const counting = counted(filterSandboxOf(() => 0));
    const testing = filterTestingOf([filterAt('/filling', filling), european], counting.sandbox);

    const stopped = await testing.verdictsOf(closedIn('eu'), now);
    const sessionsOfTheStop = counting.opened();
    const after = await testing.verdictsOf(closedIn('eu'), now);
    testing.close();

    expect(stopped).toMatchObject([{ error: { instance: '/filling' }, stopped: true }, true]);
    expect(after).toMatchObject([{ error: { instance: '/filling' }, stopped: true }, true]);
    expect([sessionsOfTheStop, counting.opened(), counting.closed()]).toEqual([2, 4, 4]);
  });
});

describe('the filters of several types tested over a page of events', () => {
  it('match a filter in the order of its attributes, so a filter that names its type first never tests an event of another type', async () => {
    const placed = { reference: '/placed', attributes: { type: 'com.acme.placed', data: '${ $data.total > 0 }' } };
    const refunded = {
      reference: '/refunded',
      attributes: { type: 'com.acme.refunded', data: '${ $data.refunded.toFixed(0) !== "0" }' },
    };
    const testing = filterTestingOf(
      [placed, refunded],
      filterSandboxOf(() => 0),
    );

    const verdicts = await testing.verdictsOf({ type: 'com.acme.placed', data: { total: 3 } }, now);
    testing.close();

    expect(verdicts).toEqual([true, false]);
  });
});

describe('the filters tested over a page of events in a sandbox that breaks', () => {
  it('close a session whose tests could not be prepared, and pass on the failure unchanged', async () => {
    const failure = new TypeError('the sandbox broke');
    const counting = counted(filterSandboxOf(() => 0));
    const breaking: FilterSandbox = {
      ...counting.sandbox,
      session: async (opening) => ({
        ...(await counting.sandbox.session(opening)),
        freeze: () => Promise.reject(failure),
      }),
    };
    const testing = filterTestingOf([european], breaking);

    await expect(testing.verdictsOf(closedIn('eu'), now)).rejects.toBe(failure);
    expect([counting.opened(), counting.closed()]).toEqual([1, 1]);
  });
});

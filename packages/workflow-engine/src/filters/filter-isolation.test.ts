import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { freshInstance } from '../instances/fresh-instances.ts';
import { unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { filterVerdictsOf } from './filter-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const closed: JsonObject = { type: 'com.acme.ledger.month-closed', data: { region: 'eu' } };

const writingTheIteratorPrototype =
  '${ (() => { const holder: any = Object.getPrototypeOf([][Symbol.iterator]()); const seen = holder.seen === true; holder.seen = true; return seen; })() }';

function filterAt(reference: string) {
  return { reference, attributes: { type: 'com.acme.ledger.month-closed', data: writingTheIteratorPrototype } };
}

async function sandbox() {
  return { instance: await freshInstance(unitMemoryBytes), clock: () => 0, now };
}

describe('the filters of one batch', () => {
  it('share no state through an intrinsic no global names, so each answers as it would alone', async () => {
    const [first, second] = [filterAt('/first'), filterAt('/second')];

    const together = filterVerdictsOf([first, second], closed, await sandbox());
    const alone = [
      ...filterVerdictsOf([first], closed, await sandbox()),
      ...filterVerdictsOf([second], closed, await sandbox()),
    ];

    expect(together).toEqual(alone);
  });
});

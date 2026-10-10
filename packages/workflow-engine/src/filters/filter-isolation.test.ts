import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import { filterVerdictsOf } from './filter-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const closed: JsonObject = { type: 'com.acme.ledger.month-closed', data: { region: 'eu' } };

const writingTheIteratorPrototype =
  '${ (() => { const holder = Object.getPrototypeOf([][Symbol.iterator]()); const seen = holder.seen === true; try { holder.seen = true; } catch {} return seen; })() }';

const filling = '${ (() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })() }';

function filterAt(reference: string, data = writingTheIteratorPrototype) {
  return { reference, attributes: { type: 'com.acme.ledger.month-closed', data } };
}

describe('the filters of one batch', () => {
  it('share no state through an intrinsic no global names, so each answers as it would alone', async () => {
    const [first, second] = [filterAt('/first'), filterAt('/second')];
    const sandbox = filterSandboxOf(() => 0);

    const together = await filterVerdictsOf([first, second], closed, sandbox, now);
    const alone = [
      ...(await filterVerdictsOf([first], closed, sandbox, now)),
      ...(await filterVerdictsOf([second], closed, sandbox, now)),
    ];

    expect(together).toEqual([false, false]);
    expect(together).toEqual(alone);
  });

  it('take a fresh context after one its sandbox refused, so one filter that fills its memory fails no other', async () => {
    const sandbox = filterSandboxOf(() => 0);

    const verdicts = await filterVerdictsOf(
      [
        filterAt('/filling', filling),
        filterAt('/eu', '${ $data.region == "eu" }'),
        filterAt('/us', '${ $data.region == "us" }'),
      ],
      closed,
      sandbox,
      now,
    );

    expect(verdicts).toMatchObject([{ error: { status: 500, instance: '/filling' } }, true, false]);
    expect(JSON.stringify(verdicts[0])).toContain('one filter may use the memory of its sandbox and no more');
  });
});

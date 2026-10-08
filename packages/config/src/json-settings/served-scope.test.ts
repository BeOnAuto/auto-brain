import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { servedScopeOf, servesBrain } from '../index.ts';

describe('the org and brains an entry serves', () => {
  it('are its org and the brains it names, or every brain of the org when it names none', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme', brains: ['sales'] }, 'server')).toEqual(
      Result.succeed({ org: 'acme', brains: ['sales'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme' }, 'server')).toEqual(
      Result.succeed({ org: 'acme', brains: null }),
    );
  });

  it('are refused without an org, or with an org or brain that is not an id, at their places', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', {}, 'endpoint')).toEqual(
      Result.fail([{ setting: 'EXAMPLE', detail: '/graph: Expected the org this endpoint serves' }]),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'ac/me', brains: ['sales', 'Sales'] }, 'server')).toEqual(
      Result.fail([
        { setting: 'EXAMPLE', detail: '/graph/org: Expected an org id' },
        { setting: 'EXAMPLE', detail: '/graph/brains/1: Expected a brain id' },
      ]),
    );
  });

  it('decide whether the entry serves a brain', () => {
    const sales = { org: 'acme', brains: ['sales'] };

    expect([
      servesBrain(sales, { org: 'acme', brain: 'sales' }),
      servesBrain(sales, { org: 'acme', brain: 'support' }),
      servesBrain({ org: 'acme', brains: null }, { org: 'acme', brain: 'support' }),
      servesBrain({ org: 'acme', brains: null }, { org: 'globex', brain: 'support' }),
    ]).toEqual([true, false, true, false]);
  });
});

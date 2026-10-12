import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { servedScopeOf, servesPlaybook } from '../index.ts';

describe('the org and playbooks an entry serves', () => {
  it('are its org and the playbooks it names, or every playbook of the org when it names none', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme', playbooks: ['sales'] }, 'server')).toEqual(
      Result.succeed({ org: 'acme', playbooks: ['sales'] }),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'acme' }, 'server')).toEqual(
      Result.succeed({ org: 'acme', playbooks: null }),
    );
  });

  it('are refused without an org, or with an org or playbook that is not an id, at their places', () => {
    expect(servedScopeOf('EXAMPLE', 'graph', {}, 'endpoint')).toEqual(
      Result.fail([{ setting: 'EXAMPLE', detail: '/graph: Expected the org this endpoint serves' }]),
    );
    expect(servedScopeOf('EXAMPLE', 'graph', { org: 'ac/me', playbooks: ['sales', 'Sales'] }, 'server')).toEqual(
      Result.fail([
        { setting: 'EXAMPLE', detail: '/graph/org: Expected an org id' },
        { setting: 'EXAMPLE', detail: '/graph/playbooks/1: Expected a playbook id' },
      ]),
    );
  });

  it('decide whether the entry serves a playbook', () => {
    const sales = { org: 'acme', playbooks: ['sales'] };

    expect([
      servesPlaybook(sales, { org: 'acme', playbook: 'sales' }),
      servesPlaybook(sales, { org: 'acme', playbook: 'support' }),
      servesPlaybook({ org: 'acme', playbooks: null }, { org: 'acme', playbook: 'support' }),
      servesPlaybook({ org: 'acme', playbooks: null }, { org: 'globex', playbook: 'support' }),
    ]).toEqual([true, false, true, false]);
  });
});

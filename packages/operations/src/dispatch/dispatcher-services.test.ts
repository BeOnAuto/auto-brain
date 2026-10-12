import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { peekPlaybookCommand, peekPlaybookQuery, peekOrgCommand, peekOrgQuery } from '../testing/probes.ts';

describe('a handler at run time', () => {
  it('sees the caller, the address and the ports of its call, with the writer for commands only', async () => {
    const { dispatcher, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toPlaybook('acme', 'alpha');
    const view = { caller: 'acme-admin', org: 'acme' };

    expect(await run(dispatcher.dispatchToOrg(peekOrgQuery.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader'] },
    });
    expect(await run(dispatcher.dispatchToOrg(peekOrgCommand.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader', 'OrgWriter'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookQuery.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, playbook: 'alpha', visible: ['Caller', 'PlaybookContext', 'PlaybookReader'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookCommand.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: {
        ...view,
        playbook: 'alpha',
        visible: ['Caller', 'PlaybookContext', 'PlaybookReader', 'PlaybookWriter'],
      },
    });
  });
});

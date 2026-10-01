import { describe, expect, it } from 'vitest';

import { acmeAdmin } from './testing/callers.ts';
import { harness, toBrain, toOrg } from './testing/harness.ts';
import { peekBrainCommand, peekBrainQuery, peekOrgCommand, peekOrgQuery } from './testing/probes.ts';

describe('a handler at run time', () => {
  it('sees the caller, the address and the ports of its call, with the writer for commands only', async () => {
    const { dispatcher, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toBrain('acme', 'alpha');
    const view = { caller: 'acme-admin', org: 'acme' };

    expect(await run(dispatcher.inOrg(peekOrgQuery.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'done',
      output: { ...view, visible: ['Caller', 'OrgScope', 'OrgReader'] },
    });
    expect(await run(dispatcher.inOrg(peekOrgCommand.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'done',
      output: { ...view, visible: ['Caller', 'OrgScope', 'OrgReader', 'OrgWriter'] },
    });
    expect(await run(dispatcher.inBrain(peekBrainQuery.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'done',
      output: { ...view, brain: 'alpha', visible: ['Caller', 'BrainScope', 'BrainReader'] },
    });
    expect(await run(dispatcher.inBrain(peekBrainCommand.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'done',
      output: { ...view, brain: 'alpha', visible: ['Caller', 'BrainScope', 'BrainReader', 'BrainWriter'] },
    });
  });
});

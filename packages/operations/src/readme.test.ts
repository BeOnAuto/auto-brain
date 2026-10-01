import { readFileSync } from 'node:fs';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from './testing/callers.ts';
import { harness, toOrg } from './testing/harness.ts';
import { getLabel, labels } from './testing/readme-example.ts';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const example = readFileSync(new URL('testing/readme-example.ts', import.meta.url), 'utf8');

describe('the example in the README', () => {
  it('is the example the tests compile and run', () => {
    expect(readme).toContain(`\`\`\`ts\n${example}\`\`\``);
  });

  it('reads one label of the org, or refuses with not_found', async () => {
    const { dispatcher, ledger, run } = harness();
    const asking = (name: string) => run(dispatcher.inOrg(getLabel.registration, toOrg('acme')(acmeAdmin, { name })));
    await Effect.runPromise(ledger.service.execute('org/acme/labels', labels, { name: 'urgent', text: 'Do it now' }));

    expect(await asking('urgent')).toEqual({ status: 'done', output: { name: 'urgent', text: 'Do it now' } });
    expect(await asking('later')).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no label later',
    });
  });
});

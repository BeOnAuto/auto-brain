import { describe, expect, it } from 'vitest';

import { configured, problemsIn } from '../testing/config-files.ts';

const secret = 'sk-proj-0123456789abcdefghijklmnop';

const writtenOut =
  'Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}';

describe('a key that names a sort of credential', () => {
  it('is not what a key its setting names as a sort of credential holds, though a value in the shape of one still is', () => {
    const { environment } = configured('example_rules: { credential_kinds: [none, secret] }\n');

    expect(environment['EXAMPLE_RULES']).toBe(JSON.stringify({ credential_kinds: ['none', 'secret'] }));
    expect(problemsIn(`example_rules: { credential_kinds: [${secret}] }\n`)).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:37 example_rules.credential_kinds[0]: ${writtenOut}`,
    );
  });

  it('is what a key that names a sort of credential holds in any other setting', () => {
    expect(problemsIn('example_servers: { graph: { headers: { X-Token-Type: bearer } } }\n')).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:54 example_servers.graph.headers.X-Token-Type: ${writtenOut}`,
    );
  });
});

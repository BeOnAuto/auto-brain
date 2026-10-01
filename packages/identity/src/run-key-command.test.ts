import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { authenticatorFor, readApiKeys } from './index.ts';
import { runKeyCommand } from './run-key-command.ts';

interface Session {
  readonly exitCode: number;
  readonly printed: readonly string[];
  readonly complaints: readonly string[];
}

function run(...args: readonly string[]): Session {
  const printed: string[] = [];
  const complaints: string[] = [];
  const exitCode = runKeyCommand(args, {
    print: (line) => {
      printed.push(line);
    },
    complain: (line) => {
      complaints.push(line);
    },
  });
  return { exitCode, printed, complaints };
}

function issued({ printed }: Session): { readonly key: string; readonly entry: string } {
  return {
    key: printed[0]?.replace('API key, shown only this once: ', '') ?? '',
    entry: printed[1]?.replace('API_KEYS entry: ', '') ?? '',
  };
}

const keyCommand = fileURLToPath(new URL('key-command.ts', import.meta.url));

const badArguments: ReadonlyArray<readonly [readonly string[], string]> = [
  [['--id', 'ci-1'], '--org: Missing key'],
  [['--org', 'a b'], '--org: Expected a string matching'],
  [['--org', 'acme', '--id', 'CI_1'], '--id: Expected a string matching'],
  [['--org', 'acme', '--permissions', 'org:read,admin'], '--permissions: Expected "org:read"'],
  [['--org', 'acme', '--brains', 'Alpha'], '--brains: Expected a string matching'],
  [['--org', 'acme', '--colour', 'red'], "Unknown option '--colour'"],
  [['--org', 'acme', 'extra'], "Unexpected argument 'extra'"],
];

describe('the key command', () => {
  it('prints a key once and the API_KEYS entry that admits it, with a random id, every permission and every brain', () => {
    const session = run('--org', 'demo');
    const { key, entry } = issued(session);
    const apiKeys = readApiKeys({ API_KEYS: `[${entry}]` });

    expect(session).toMatchObject({ exitCode: 0, complaints: [] });
    expect(apiKeys).toMatchObject([
      { org: 'demo', permissions: ['org:read', 'org:write', 'brain:read', 'brain:write'], brains: '*' },
    ]);
    expect(apiKeys?.[0]?.id).toMatch(/^[0-9a-f]{8}$/u);
    expect(authenticatorFor({ host: '0.0.0.0', apiKeys }).authenticate(key)?.callerIn('demo').org).toBe('demo');
  });

  it('takes the id, the permissions and the brains it is given, after an optional --', () => {
    const session = run(
      '--',
      '--org',
      'acme',
      '--id',
      'ci-1',
      '--permissions',
      'brain:read,org:read',
      '--brains',
      'alpha,beta',
    );

    expect(JSON.parse(issued(session).entry)).toMatchObject({
      id: 'ci-1',
      org: 'acme',
      permissions: ['brain:read', 'org:read'],
      brains: ['alpha', 'beta'],
    });
  });

  it('accepts * for every brain', () => {
    expect(JSON.parse(issued(run('--org', 'acme', '--brains', '*')).entry)).toMatchObject({ brains: '*' });
  });
});

describe('the key command with bad arguments', () => {
  it.each(badArguments)('refuses %j, saying why and how to call it, and prints no key', (args, reason) => {
    const session = run(...args);

    expect(session.exitCode).toBe(1);
    expect(session.printed).toEqual([]);
    expect(session.complaints[0]).toContain(reason);
    expect(session.complaints[1]).toMatch(/^Arguments: --org <org id>/u);
  });
});

describe('the key command as a process', () => {
  it('prints the key and the entry to stdout and exits 0', () => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [keyCommand, '--org', 'demo'], { encoding: 'utf8' });

    expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
    expect(stdout).toMatch(
      /^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}\nAPI_KEYS entry: \{.*\}\n$/u,
    );
  });

  it('explains bad arguments on stderr, prints nothing on stdout and exits non-zero', () => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [keyCommand], { encoding: 'utf8' });

    expect({ status, stdout }).toEqual({ status: 1, stdout: '' });
    expect(stderr).toContain('--org: Missing key');
  });
});

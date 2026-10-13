import { describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { servedLocally, type LocalServerHost } from './local-server.ts';

interface Served {
  readonly host: LocalServerHost;
  readonly written: string[];
  readonly stop: () => void;
  readonly stops: () => number;
}

function served(settings: Readonly<Record<string, string>>, run?: LocalServerHost['run']): Served {
  const written: string[] = [];
  const { promise: stopRequested, resolve: stop } = Promise.withResolvers<void>();
  const clock = [1000, 1640];
  let stops = 0;
  return {
    written,
    stop,
    stops: () => stops,
    host: {
      settings,
      home: '/home/ada',
      depth: 1,
      write: (text) => {
        written.push(text);
      },
      clock: () => clock.shift() ?? 0,
      run:
        run ??
        (() =>
          Promise.resolve({
            port: 5600,
            stop: () => {
              stops += 1;
              return Promise.resolve();
            },
          })),
      stopRequested,
    },
  };
}

describe('serving the runtime on this computer', () => {
  it('shows the header, then the ready notice with the port and the time it took, and stops when asked', async () => {
    const local = served({ LEDGER_FILE: '/home/ada/.auto-runtime/ledger.db', ANTHROPIC_API_KEY: 'sk-ant-test' });

    const serving = servedLocally(local.host);
    await expect.poll(() => local.written).toHaveLength(2);
    local.stop();
    await serving;

    expect(local.written[0]).toBe(`\nAuto Runtime v${release.version}\nRuns the playbooks your agent builds\n\n`);
    expect(local.written[1]).toContain('  ✔ Ready in 640 ms\n');
    expect(local.written[1]).toContain('  ➜  Server   http://localhost:5600\n');
    expect(local.written[1]).toContain('  ➜  Models   anthropic\n');
    expect(local.written[1]).toContain('  ➜  Ledger   ~/.auto-runtime/ledger.db\n');
    expect(local.written.slice(2)).toEqual(['\n  Stopping…\n', '  ✔ Stopped\n']);
    expect(local.stops()).toBe(1);
  });

  it.each([
    [{ LEDGER_FILE: '/srv/ledger.db' }, '/srv/ledger.db'],
    [{ LEDGER_FILE: ':memory:' }, 'in memory, for this run only'],
    [
      { DATABASE_URL: 'postgresql://auto:secret@db.example:5432/playbooks' },
      'PostgreSQL, the database playbooks on db.example:5432',
    ],
  ])(
    'says where the ledger of %j is kept, never with its password',
    async (settings: Readonly<Record<string, string>>, ledger: string) => {
      const local = served(settings);

      const serving = servedLocally(local.host);
      await expect.poll(() => local.written).toHaveLength(2);
      local.stop();
      await serving;

      expect(local.written[1]).toContain(`  ➜  Ledger   ${ledger}\n`);
      expect(local.written[1]).not.toContain('secret');
    },
  );

  it('fails as the server failed to start, after the header', async () => {
    const local = served({}, () => Promise.reject(new Error('port 5600 is in use')));

    await expect(servedLocally(local.host)).rejects.toThrow('port 5600 is in use');
    expect(local.written).toHaveLength(1);
  });
});

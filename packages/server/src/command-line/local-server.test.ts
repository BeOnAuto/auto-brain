import { stripVTControlCharacters } from 'node:util';

import { describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import type { ColorDepth } from '../logging/terminal.ts';
import { servedLocally, type LocalServerHost } from './local-server.ts';

interface Served {
  readonly host: LocalServerHost;
  readonly written: string[];
  readonly stop: () => void;
  readonly stops: () => number;
  readonly tick: () => void;
  readonly spinning: () => boolean;
}

interface Options {
  readonly depth?: ColorDepth;
  readonly run?: LocalServerHost['run'];
}

function stoppable(count: () => void): ReturnType<LocalServerHost['run']> {
  return Promise.resolve({
    port: 5600,
    stop: () => {
      count();
      return Promise.resolve();
    },
  });
}

function served({ depth = 1, run }: Options = {}): Served {
  const written: string[] = [];
  const { promise: stopRequested, resolve: stop } = Promise.withResolvers<void>();
  const clock = [1000, 1640];
  let stops = 0;
  const ticks: (() => void)[] = [];
  let spinning = false;
  return {
    written,
    stop,
    stops: () => stops,
    tick: () => {
      for (const tick of ticks) {
        tick();
      }
    },
    spinning: () => spinning,
    host: {
      depth,
      write: (text) => {
        written.push(text);
      },
      clock: () => clock.shift() ?? 0,
      tickEvery: (milliseconds, tick) => {
        expect(milliseconds).toBe(80);
        ticks.push(tick);
        spinning = true;
        return () => {
          spinning = false;
        };
      },
      run:
        run ??
        (() =>
          stoppable(() => {
            stops += 1;
          })),
      stopRequested,
    },
  };
}

describe('serving the runtime on this computer', () => {
  it('shows the header, then the ready notice with the port and the time it took, and stops when asked', async () => {
    const local = served();

    const serving = servedLocally(local.host);
    await expect.poll(() => local.written).toHaveLength(2);
    local.stop();
    await serving;

    expect(local.written[0]).toBe(`\nAuto Runtime v${release.version}\nRuns the playbooks your agent builds\n\n`);
    expect(local.written[1]).toContain('  ✔ Ready in 640 ms\n');
    expect(local.written[1]).toContain('     Server   http://localhost:5600\n');
    expect(local.written.slice(2)).toEqual(['\n  Stopping…\n', '  ✔ Stopped\n']);
    expect(local.stops()).toBe(1);
  });

  it('fails as the server failed to start, after the header', async () => {
    const local = served({ run: () => Promise.reject(new Error('port 5600 is in use')) });

    await expect(servedLocally(local.host)).rejects.toThrow('port 5600 is in use');
    expect(local.written).toHaveLength(1);
  });
});

describe('the spinner while the runtime starts at a terminal', () => {
  it('turns on its line until the server is ready, then clears it for the ready notice', async () => {
    const { promise: listening, resolve: listen } = Promise.withResolvers<void>();
    const local = served({
      depth: 24,
      run: async () => {
        await listening;
        return stoppable(() => {
          listen();
        });
      },
    });

    const serving = servedLocally(local.host);
    local.tick();
    local.tick();
    listen();
    await expect.poll(() => local.written).toHaveLength(6);
    local.stop();
    await serving;

    expect(local.written.slice(1, 4).map((text) => stripVTControlCharacters(text))).toEqual([
      '\r  ⠋ Starting…',
      '\r  ⠙ Starting…',
      '\r  ⠹ Starting…',
    ]);
    expect(local.written[4]).toBe('\r\u001B[2K');
    expect(stripVTControlCharacters(String(local.written[5]))).toMatch(/^ {2}✔ Ready in 640 ms\n/u);
    expect(local.spinning()).toBe(false);
  });

  it('stops and clears its line when the server fails to start', async () => {
    const local = served({ depth: 24, run: () => Promise.reject(new Error('port 5600 is in use')) });

    await expect(servedLocally(local.host)).rejects.toThrow('port 5600 is in use');
    expect(local.written.at(-1)).toBe('\r\u001B[2K');
    expect(local.spinning()).toBe(false);
  });
});

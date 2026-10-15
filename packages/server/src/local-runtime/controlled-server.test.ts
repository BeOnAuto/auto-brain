import { describe, expect, it, onTestFinished } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import { servedBy } from '../lifecycle/lifecycle.ts';
import { optionsServing } from '../testing/entries/serving-options.ts';
import { testRoutes } from '../testing/entries/test-routes.ts';
import { localControlOf, runtimeStatusOf } from './local-control.ts';

const loopback = { HOST: '127.0.0.1', PORT: '0', LOCAL_MODE: 'true' };

const status = runtimeStatusOf({
  version: '0.9.1',
  pid: 4242,
  startedAt: new Date('2026-10-14T09:41:07.000Z'),
  directory: '/Users/ada/playbooks',
  home: '/Users/ada',
  startedBy: 'terminal',
});

describe('a server started with the control of the auto-runtime command', () => {
  it('says what runs, and hears that it should stop', async () => {
    const { control, asked } = localControlOf(status);
    const server = await startServer(loopback, {
      ...optionsServing(() => servedBy([testRoutes])),
      runtimeControl: control,
    });
    onTestFinished(() => server.stop());

    const read = await fetch(`http://localhost:${server.port}/runtime`);
    const stopping = await fetch(`http://localhost:${server.port}/runtime/stop`, { method: 'POST' });

    expect(await read.json()).toMatchObject({ version: '0.9.1', pid: 4242, started_by: 'terminal' });
    expect(await stopping.json()).toEqual({ status: 'stopping' });
    await expect(asked).resolves.toBe('stop');
  });

  it('has no control without one', async () => {
    const server = await startServer(
      loopback,
      optionsServing(() => servedBy([testRoutes])),
    );
    onTestFinished(() => server.stop());

    expect((await fetch(`http://localhost:${server.port}/runtime`)).status).toBe(404);
  });
});

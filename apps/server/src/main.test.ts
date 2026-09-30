import { spawn } from 'node:child_process';
import { once, type EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const mainModule = fileURLToPath(new URL('main.ts', import.meta.url));

async function firstValueOf(emitter: Readonly<EventEmitter>, eventName: string): Promise<unknown> {
  const values: unknown[] = await once(emitter, eventName);
  return values[0];
}

describe('main', () => {
  it('serves health checks when launched with node and exits cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, [mainModule], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.setEncoding('utf8');
    const announcement = String(await firstValueOf(child.stdout, 'data'));
    const port = Number(/port (\d+)/u.exec(announcement)?.[1]);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.kill('SIGTERM');
    const exitCode = await firstValueOf(child, 'exit');

    expect({ status: health.status, exitCode }).toEqual({ status: 200, exitCode: 0 });
  });
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';

export interface Spawned {
  readonly port: Promise<number>;
  readonly exited: Promise<unknown>;
  readonly output: () => { readonly stdout: string; readonly stderr: string };
  readonly signal: (name: NodeJS.Signals) => void;
}

export function spawnEntry(entry: string, env: Readonly<Record<string, string>>): Spawned {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  const { promise: port, resolve: announce } = Promise.withResolvers<number>();
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    announce(Number(/port (\d+)/u.exec(output.stdout)?.[1]));
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  return {
    port,
    exited,
    output: () => ({ ...output }),
    signal: (name) => {
      child.kill(name);
    },
  };
}

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('../../../auto-runtime.ts', import.meta.url));

export interface RuntimeCommandRun {
  readonly pid: number | undefined;
  readonly write: (text: string) => void;
  readonly end: () => void;
  readonly kill: () => void;
  readonly interrupt: () => void;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<unknown>;
}

export interface RuntimeCommandPlace {
  readonly home: string;
  readonly port: number;
  readonly settings?: Readonly<Record<string, string>>;
}

export function spawnRuntimeCommand(
  args: readonly string[],
  { home, port, settings = {} }: RuntimeCommandPlace,
): RuntimeCommandRun {
  const child = spawn(process.execPath, [command, ...args], {
    cwd: home,
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      PATH: process.env['PATH'],
      HOME: home,
      PORT: String(port),
      ...settings,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  return {
    pid: child.pid,
    write: (text) => {
      child.stdin.write(text);
    },
    end: () => {
      child.stdin.end();
    },
    kill: () => {
      child.kill('SIGKILL');
    },
    interrupt: () => {
      child.kill('SIGINT');
    },
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    exited: once(child, 'exit').then(([code]: readonly unknown[]) => code),
  };
}

export async function ranToEnd(
  args: readonly string[],
  place: RuntimeCommandPlace,
): Promise<{ readonly code: unknown; readonly stdout: string }> {
  const run = spawnRuntimeCommand(args, place);
  run.end();
  const code = await run.exited;
  return { code, stdout: run.stdout() };
}

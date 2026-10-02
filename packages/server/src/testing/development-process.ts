import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Option, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { freePort } from './workflow-process.ts';

export const developmentTestTimeoutMs = 60_000;

export interface DevelopmentFiles {
  readonly directory: string;
  readonly envFile: string;
  readonly localEnvFile: string;
  readonly configFile: string;
  readonly sourceDirectory: string;
  readonly serverEntry: string;
  readonly pidsFile: string;
  readonly stateFile: string;
  readonly ledgerFile: string;
}

export interface LocalTemporalPorts {
  readonly port: number;
  readonly uiPort: number;
}

type Obtain = 'cached' | 'held until stopped' | { readonly unobtainable: string };

export interface DevelopmentOptions {
  readonly temporal?: LocalTemporalPorts;
  readonly obtain?: Obtain;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface Development {
  readonly files: DevelopmentFiles;
  readonly exited: Promise<unknown>;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly signal: (name: NodeJS.Signals) => void;
}

const runner = fileURLToPath(new URL('run-development.ts', import.meta.url));

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const pidLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ pid: Schema.optional(Schema.Number) })));

export function developmentFiles(envFileText = 'HOST=127.0.0.1\nLOCAL_MODE=true\n'): DevelopmentFiles {
  const directory = mkdtempSync(join(tmpdir(), 'auto-brain-development-'));
  const files = {
    directory,
    envFile: join(directory, 'dev.env'),
    localEnvFile: join(directory, '.env'),
    configFile: join(directory, 'auto-brain.yaml'),
    sourceDirectory: join(directory, 'src'),
    serverEntry: join(directory, 'src', 'entry.ts'),
    pidsFile: join(directory, 'pids'),
    stateFile: join(directory, '.data', 'temporal.db'),
    ledgerFile: join(directory, 'ledger.db'),
  };
  writeFileSync(files.envFile, envFileText);
  writeFileSync(files.pidsFile, '');
  mkdirSync(files.sourceDirectory);
  writeServerEntry(files);
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return files;
}

export function writeServerEntry({ serverEntry }: DevelopmentFiles, source = `import '${mainModule}';\n`): void {
  writeFileSync(serverEntry, source);
}

export async function localTemporalPorts(): Promise<LocalTemporalPorts> {
  return { port: await freePort(), uiPort: await freePort() };
}

export function startDevelopment(files: DevelopmentFiles, options: DevelopmentOptions = {}): Development {
  const setup = {
    envFiles: [files.envFile, files.localEnvFile],
    sourceDirectory: files.sourceDirectory,
    serverEntry: files.serverEntry,
    configFile: files.configFile,
    pidsFile: files.pidsFile,
    ...(options.temporal === undefined ? {} : { temporal: { ...options.temporal, stateFile: files.stateFile } }),
    obtain: options.obtain ?? 'cached',
  };
  const child = spawn(process.execPath, [runner, JSON.stringify(setup)], {
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      HOME: homedir(),
      TMPDIR: tmpdir(),
      PORT: '0',
      LEDGER_FILE: files.ledgerFile,
      ...options.environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  onTestFinished(async () => {
    child.kill('SIGTERM');
    await exited;
  }, developmentTestTimeoutMs);
  return {
    files,
    exited,
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    signal: (name) => {
      child.kill(name);
    },
  };
}

export function pidsOf({ files }: Development): readonly number[] {
  return readFileSync(files.pidsFile, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => Number(pidLine(line).pid));
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function aliveGroups(development: Development): readonly number[] {
  return pidsOf(development).filter((pid) => groupAlive(pid));
}

const goneWithinMs = 30_000;

export async function untilGone(
  development: Development,
  deadline = Date.now() + goneWithinMs,
): Promise<readonly number[]> {
  const alive = aliveGroups(development);
  if (alive.length === 0 || Date.now() >= deadline) {
    return alive;
  }
  await setTimeout(50);
  return untilGone(development, deadline);
}

export async function untilWritten(read: () => string, wanted: Readonly<RegExp>): Promise<RegExpExecArray> {
  const found = wanted.exec(read());
  if (found !== null) {
    return found;
  }
  await setTimeout(50);
  return untilWritten(read, wanted);
}

const logLineOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Struct({ source: Schema.optional(Schema.String) }),
    }),
  ),
);

function linesFrom({ stderr }: Development, source: string): readonly string[] {
  return stderr()
    .split('\n')
    .flatMap((line) => Option.toArray(logLineOf(line)))
    .filter((entry) => entry.annotations.source === source)
    .map(({ level, message }) => `${level} ${message}`);
}

const readyNotice = /^INFO auto-brain is ready\n/u;

export function runnerLines(development: Development): readonly string[] {
  return linesFrom(development, 'dev')
    .filter((line) => !readyNotice.test(line))
    .map((line) => line.replace(/^\S+ /u, ''));
}

export function readyNoticesOf(development: Development): readonly string[] {
  return linesFrom(development, 'dev')
    .filter((line) => readyNotice.test(line))
    .map((line) => line.replace(readyNotice, ''));
}

export function temporalLines(development: Development): readonly string[] {
  return linesFrom(development, 'temporal');
}

function listeningPorts({ stdout }: Development): readonly number[] {
  return [...stdout().matchAll(/auto-brain listening on port (\d+)\n/gu)].map(([, port]: readonly string[]) =>
    Number(port),
  );
}

export async function untilListening(development: Development, times = 1): Promise<number> {
  const ports = listeningPorts(development);
  if (ports.length >= times) {
    return Number(ports.at(times - 1));
  }
  await setTimeout(50);
  return untilListening(development, times);
}

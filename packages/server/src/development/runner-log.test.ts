import { Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { runnerLog, type RunnerLog } from './runner-log.ts';

interface Entry {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

function described({ level, message, annotations }: Entry): string {
  return `${level} ${String(message)} ${JSON.stringify(annotations)}`;
}

function capturing(): { readonly log: RunnerLog; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const capture = Logger.map(Logger.map(Logger.formatStructured, described), (line: string) => {
    lines.push(line);
  });
  return { log: runnerLog(Logger.layer([capture])), lines };
}

describe('the dev runner log', () => {
  it('marks its own lines as coming from dev, at their level', () => {
    const { log, lines } = capturing();

    log.info('Temporal is running');
    log.warn('The server stopped');
    log.error('Temporal stopped');

    expect(lines).toEqual([
      'INFO Temporal is running {"source":"dev"}',
      'WARN The server stopped {"source":"dev"}',
      'ERROR Temporal stopped {"source":"dev"}',
    ]);
  });

  it("passes on Temporal's JSON log lines at their level, with their fields and without their time", () => {
    const { log, lines } = capturing();

    log.temporal('{"time":"2026-10-02T11:51:19+01:00","level":"ERROR","msg":"service failures","operation":"Poll"}');
    log.temporal('{"time":"2026-10-02T11:51:19+01:00","level":"WARN","msg":"Failed to poll for task."}');
    log.temporal('{"time":"2026-10-02T11:51:19+01:00","level":"INFO","msg":"started"}');
    log.temporal('{"level":"DEBUG","msg":"tick"}');

    expect(lines).toEqual([
      'ERROR service failures {"source":"temporal","operation":"Poll"}',
      'WARN Failed to poll for task. {"source":"temporal"}',
      'INFO started {"source":"temporal"}',
      'WARN tick {"source":"temporal"}',
    ]);
  });

  it("passes on Temporal's other lines as errors, whole", () => {
    const { log, lines } = capturing();

    log.temporal("Error: can't set UI port 8233: bind: address already in use");
    log.temporal('{"level":"ERROR","detail":"no message"}');

    expect(lines).toEqual([
      'ERROR Error: can\'t set UI port 8233: bind: address already in use {"source":"temporal"}',
      'ERROR {"level":"ERROR","detail":"no message"} {"source":"temporal","detail":"no message"}',
    ]);
  });
});

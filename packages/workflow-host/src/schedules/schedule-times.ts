import { Cron } from 'croner';

export type Timing =
  | { readonly kind: 'cron'; readonly expression: string }
  | { readonly kind: 'every'; readonly milliseconds: number };

const fieldsOfACron = 5;

const aSecond = 1000;

function cronOf(expression: string): Cron {
  return new Cron(expression, { timezone: 'UTC', mode: '5-part', domAndDow: false, paused: true });
}

export function cronRejectionOf(expression: string): string | undefined {
  if (expression.trim().split(/\s+/u).length !== fieldsOfACron) {
    return `A cron expression has five fields, minute, hour, day of month, month and day of week, not ${JSON.stringify(expression)}`;
  }
  try {
    return cronOf(expression).nextRun() === null
      ? `The cron expression ${expression} names no time that comes`
      : undefined;
  } catch (error) {
    return `The cron expression ${expression} cannot be read: ${String(error).replace(/^\w*Error: /u, '')}`;
  }
}

export function nextAfter(timing: Timing, anchor: number, after: number): number | null {
  if (timing.kind === 'every') {
    return anchor + (Math.floor((after - anchor) / timing.milliseconds) + 1) * timing.milliseconds;
  }
  return cronOf(timing.expression).nextRun(new Date(after))?.getTime() ?? null;
}

export function latestDue(timing: Timing, anchor: number, due: number, now: number): number {
  if (timing.kind === 'every') {
    return anchor + Math.floor((now - anchor) / timing.milliseconds) * timing.milliseconds;
  }
  const previous = cronOf(timing.expression).previousRuns(1, new Date(now + aSecond));
  return Math.max(due, ...previous.map((run) => run.getTime()));
}

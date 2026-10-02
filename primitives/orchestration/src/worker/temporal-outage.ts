import { makeThrottle } from '../notices/throttle.ts';
import type { TemporalLogContext, TemporalLogEntry } from './temporal-runtime.ts';

export interface OutageWatch {
  readonly troubled: (now: number, context: TemporalLogContext) => TemporalLogEntry | undefined;
  readonly recovered: (now: number) => TemporalLogEntry | undefined;
}

const outageLineEveryMs = 60_000;

const lostTemporal = /^Temporal reported: (?:gRPC call \w+ retried \d+ times|Network error\b)/u;

export function isLostTemporal({ message }: TemporalLogEntry): boolean {
  return lostTemporal.test(message);
}

export function makeOutageWatch(): OutageWatch {
  let since: number | undefined;
  let throttle = makeThrottle(outageLineEveryMs);
  const outageLine = (now: number, context: TemporalLogContext, suppressed: number): TemporalLogEntry => {
    if (since === undefined) {
      since = now;
      return { level: 'WARN', message: 'The workflow worker lost Temporal', context };
    }
    return {
      level: 'WARN',
      message: 'The workflow worker still cannot reach Temporal',
      context: { ...context, lost_for_ms: now - since, suppressed },
    };
  };
  return {
    troubled: (now, context) => {
      const admission = throttle.admit(now);
      return admission.admitted ? outageLine(now, context, admission.suppressed) : undefined;
    },
    recovered: (now) => {
      const lostForMs = since === undefined ? undefined : now - since;
      since = undefined;
      throttle = makeThrottle(outageLineEveryMs);
      return lostForMs === undefined
        ? undefined
        : { level: 'INFO', message: 'The workflow worker reached Temporal again', context: { lost_for_ms: lostForMs } };
    },
  };
}

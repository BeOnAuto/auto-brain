import type { Json } from '../dsl/json.ts';
import { exhaustedBy, type Evaluation, type ProgramRun } from './program-run.ts';
import {
  sandboxRuntimeOf,
  type SandboxInstance,
  type SandboxRuntime,
  type SandboxSettings,
} from './sandbox-session.ts';
import type { Stripping } from './type-stripping.ts';

export type Arguments = Readonly<Record<string, Json>>;

export interface ExpressionUnit {
  readonly evaluate: (source: string, values: Arguments, evaluation: Evaluation) => ProgramRun;
  readonly took: () => boolean;
  readonly close: () => void;
}

interface Opened {
  readonly instance: SandboxInstance;
  readonly runtime: SandboxRuntime;
}

const argumentName = /\$[A-Za-z_][\w$]*/gu;

export function namesIn(source: string): ReadonlySet<string> {
  return new Set(source.match(argumentName));
}

function namedIn(source: string, values: Arguments): readonly string[] {
  const named = namesIn(source);
  return Object.keys(values).filter((name) => named.has(`$${name}`));
}

export function expressionUnitOf(
  instances: () => SandboxInstance,
  settings: SandboxSettings,
  stripping: Stripping,
): ExpressionUnit {
  const opened: { current?: Opened } = {};
  const openedNow = (): Opened => {
    if (opened.current === undefined) {
      const instance = instances();
      opened.current = { instance, runtime: sandboxRuntimeOf(instance, settings) };
    }
    return opened.current;
  };
  return {
    evaluate: (source, values, evaluation) => {
      const names = namedIn(source, values);
      const stripped = stripping.expression(
        source,
        names.map((name) => `$${name}`),
      );
      if ('issue' in stripped) {
        return { ran: 'raised', issue: stripped.issue, work: 0 };
      }
      const { instance, runtime } = openedNow();
      if (instance.refusedGrowth() || runtime.broken()) {
        return exhaustedBy(instance.refusedGrowth() ? 'memory' : 'stack', 0);
      }
      const context = runtime.context();
      try {
        const loaded = context.expression(stripped.javascript, evaluation);
        const args = names.map((name) => JSON.stringify(values[name]));
        return 'failed' in loaded
          ? loaded.failed
          : context.call({ fn: loaded.kept, args, form: 'expression', keep: false }, evaluation).run;
      } finally {
        context.close();
      }
    },
    took: () => opened.current !== undefined,
    close: () => {
      opened.current?.runtime.close();
    },
  };
}

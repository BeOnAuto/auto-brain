import type { Json } from '../dsl/json.ts';
import { expressionScript } from './expression-script.ts';
import { exhaustedBy, type Evaluation, type ProgramRun } from './program-run.ts';
import {
  sandboxRuntimeOf,
  type SandboxInstance,
  type SandboxRuntime,
  type SandboxSettings,
} from './sandbox-session.ts';

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

function namesIn(source: string): ReadonlySet<string> {
  return new Set(source.match(argumentName));
}

function namedIn(source: string, values: Arguments): readonly string[] {
  const named = namesIn(source);
  return Object.keys(values).filter((name) => named.has(`$${name}`));
}

export function expressionUnitOf(instances: () => SandboxInstance, settings: SandboxSettings): ExpressionUnit {
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
      const { instance, runtime } = openedNow();
      if (instance.refusedGrowth() || runtime.broken()) {
        return exhaustedBy(instance.refusedGrowth() ? 'memory' : 'stack', 0);
      }
      const context = runtime.context();
      try {
        const loaded = context.expression(
          expressionScript(
            source,
            names.map((name) => `$${name}`),
          ),
          evaluation,
        );
        const args = names.map((name) => JSON.stringify(values[name]));
        return 'failed' in loaded
          ? loaded.failed
          : context.call({ fn: loaded.kept, args, form: 'expression' }, evaluation);
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

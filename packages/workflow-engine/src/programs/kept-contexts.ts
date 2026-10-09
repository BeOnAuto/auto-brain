import type { Evaluation, ProgramFailure, ProgramRun } from './program-run.ts';
import {
  sandboxRuntimeOf,
  type SandboxContext,
  type SandboxInstance,
  type SandboxSettings,
  type Settled,
} from './sandbox-session.ts';
import type { Stripping } from './type-stripping.ts';

export type FilterTest = (value: string, evaluation: Evaluation) => ProgramRun;

export type Fold = (event: string, evaluation: Evaluation) => ProgramRun;

export interface FilterContext {
  readonly define: (source: string) => FilterTest;
  readonly freeze: () => ProgramFailure | undefined;
  readonly close: () => void;
}

export type FoldingUnit =
  | { readonly refused: ProgramFailure; readonly close: () => void }
  | (FilterContext & { readonly fold: Fold });

export interface FoldingSource {
  readonly fold: string;
  readonly view: string;
}

export interface Preparing {
  readonly stripping: Stripping;
  readonly evaluation: Evaluation;
}

const filterArgument = '$data';

const foldEntry = 'fold';

function raisedWith(detail: string, line: number | null): ProgramFailure {
  return { ran: 'raised', issue: { detail, line }, work: 0 };
}

function closing(context: SandboxContext, close: () => void): () => void {
  return () => {
    context.close();
    close();
  };
}

function keptOn(context: SandboxContext, preparing: Preparing, roots: readonly number[]): Omit<FilterContext, 'close'> {
  const defined: number[] = [...roots];
  const state: { frozen: ProgramFailure | undefined } = { frozen: undefined };
  const definedTest = (settled: Settled): FilterTest => {
    if ('failed' in settled) {
      return () => settled.failed;
    }
    defined.push(settled.kept);
    return (value, evaluation) =>
      state.frozen ??
      context.call({ fn: settled.kept, args: [value], form: 'expression', keep: false }, evaluation).run;
  };
  return {
    define: (source) => {
      const stripped = preparing.stripping.expression(source, [filterArgument]);
      return definedTest(
        'issue' in stripped
          ? { failed: raisedWith(stripped.issue.detail, stripped.issue.line) }
          : context.expression(stripped.javascript, preparing.evaluation),
      );
    },
    freeze: () => {
      const frozen = context.freeze(defined, preparing.evaluation);
      state.frozen = 'failed' in frozen ? frozen.failed : state.frozen;
      return state.frozen;
    },
  };
}

export function filterContextOf(
  instance: SandboxInstance,
  settings: SandboxSettings,
  preparing: Preparing,
): FilterContext {
  const runtime = sandboxRuntimeOf(instance, settings);
  const context = runtime.context(true);
  return { ...keptOn(context, preparing, []), close: closing(context, runtime.close) };
}

type LoadedFold = { readonly namespace: number; readonly fold: number } | { readonly failed: ProgramFailure };

function loadedFold(context: SandboxContext, source: string, preparing: Preparing): LoadedFold {
  const stripped = preparing.stripping.module(source);
  if ('issue' in stripped) {
    return { failed: raisedWith(stripped.issue.detail, stripped.issue.line) };
  }
  const namespace = context.module(stripped.javascript, preparing.evaluation);
  if ('failed' in namespace) {
    return namespace;
  }
  const fold = context.exported(namespace.kept, foldEntry);
  return fold === undefined
    ? { failed: raisedWith('The program exports no function fold', null) }
    : { namespace: namespace.kept, fold };
}

function foldingOf(context: SandboxContext, fold: number, view: number): Fold {
  const current = { view };
  return (event, evaluation) => {
    const called = context.call({ fn: fold, args: [current.view, event], form: 'module', keep: true }, evaluation);
    if (called.kept !== undefined) {
      context.forget(current.view);
      current.view = called.kept;
    }
    return called.run;
  };
}

export function foldingUnitOf(
  instance: SandboxInstance,
  settings: SandboxSettings,
  source: FoldingSource,
  preparing: Preparing,
): FoldingUnit {
  const runtime = sandboxRuntimeOf(instance, settings);
  const context = runtime.context(true);
  const close = closing(context, runtime.close);
  const loaded = loadedFold(context, source.fold, preparing);
  if ('failed' in loaded) {
    return { refused: loaded.failed, close };
  }
  const view = context.parsed(source.view, preparing.evaluation);
  if ('failed' in view) {
    return { refused: view.failed, close };
  }
  return { ...keptOn(context, preparing, [loaded.namespace]), fold: foldingOf(context, loaded.fold, view.kept), close };
}

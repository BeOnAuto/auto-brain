import type { Json, JsonObject } from '../dsl/json.ts';
import { jsonBytesWithin, mostIssueBytes, textWithin } from '../programs/byte-sizes.ts';
import { compileProgram, type CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramLimits, ProgramRun } from '../programs/program-running.ts';
import type { ProgramSpan } from '../programs/program-tree.ts';
import { hasTheAttributes } from './fold-filters.ts';

export type StallKind = 'raised' | 'none' | 'several' | 'work' | 'depth' | 'unfit' | 'size' | 'schema' | 'refused';

export interface FoldStall {
  readonly at: number;
  readonly kind: StallKind;
  readonly message: string;
  readonly span: ProgramSpan | null;
}

export interface FoldingView {
  readonly fold: string;
  readonly filters: readonly JsonObject[];
  readonly view: Json;
  readonly schema?: JsonObject;
  readonly events: readonly number[];
}

export interface FoldPage {
  readonly events: readonly JsonObject[];
  readonly views: readonly FoldingView[];
  readonly dialect: Dialect;
  readonly variable: string;
  readonly limits: ProgramLimits;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
}

export interface FoldedView {
  readonly view: Json;
  readonly folded: number;
  readonly lastFolded: number;
  readonly work: number;
  readonly stall?: FoldStall;
  readonly overtime?: number;
}

export interface FoldedPage {
  readonly through: number;
  readonly early: boolean;
  readonly views: readonly FoldedView[];
}

export type ViewCheck = (view: Json) => string | undefined;

export interface FoldHost {
  readonly now: () => number;
  readonly folding: (event: number, view: number) => void;
  readonly checkOf: (schema: JsonObject) => ViewCheck;
}

interface Prepared {
  readonly compiled: CompiledProgram;
  readonly filters: readonly JsonObject[];
  readonly check: ViewCheck | undefined;
  readonly considered: ReadonlySet<number>;
}

interface Folding {
  readonly prepared: Prepared;
  readonly state: FoldedView;
}

type Step = { readonly view: Json } | { readonly stall: Omit<FoldStall, 'at'> } | { readonly overtime: true };

const anywhere: ProgramSpan | null = null;

function stalled(kind: StallKind, message: string, span: ProgramSpan | null = anywhere): Step {
  return { stall: { kind, message: textWithin(message, mostIssueBytes), span } };
}

function foldingOf({ fold, filters, view, schema, events }: FoldingView, dialect: Dialect, host: FoldHost): Folding {
  return {
    prepared: {
      compiled: compileProgram(fold, dialect),
      filters,
      check: schema === undefined ? undefined : host.checkOf(schema),
      considered: new Set(events),
    },
    state: { view, folded: 0, lastFolded: -1, work: 0 },
  };
}

function matches({ filters }: Prepared, event: JsonObject): boolean {
  return filters.some((filter) => hasTheAttributes(filter, event));
}

function answeredStep(value: Json, { check }: Prepared, page: FoldPage): Step {
  if (jsonBytesWithin(value, page.mostViewBytes) > page.mostViewBytes) {
    return stalled('size', `The view takes more than the ${page.mostViewBytes} bytes as JSON a view may`);
  }
  const refused = check?.(value);
  return refused === undefined ? { view: value } : stalled('schema', refused);
}

function stepOf(run: ProgramRun, prepared: Prepared, page: FoldPage): Step {
  if (run.ran === 'answered') {
    return answeredStep(run.value, prepared, page);
  }
  if (run.ran === 'raised') {
    return stalled('raised', run.issue.detail, run.issue.span);
  }
  if (run.ran === 'exhausted') {
    if (run.limit === 'deadline') {
      return { overtime: true };
    }
    return stalled(run.limit === 'work' ? 'work' : 'depth', run.issue.detail, run.issue.span);
  }
  if (run.ran === 'unanswered') {
    return stalled(run.outputs === 0 ? 'none' : 'several', `The fold gave ${run.outputs} outputs`);
  }
  return stalled('unfit', 'The fold gave a number JSON cannot carry, such as nan or infinite');
}

interface PlacedEvent {
  readonly at: number;
  readonly event: JsonObject;
}

interface Folded {
  readonly step: Step;
  readonly work: number;
}

function foldedStep({ prepared, state }: Folding, event: JsonObject, page: FoldPage, clock: FoldHost): Folded {
  if ('issues' in prepared.compiled) {
    const [{ detail, span }] = prepared.compiled.issues;
    return { step: stalled('refused', `The fold does not compile on this server: ${detail}`, span), work: 0 };
  }
  const run = prepared.compiled.program.run(state.view, {
    limits: page.limits,
    outputs: 'exactly one',
    variables: { [page.variable]: event },
    deadline: { milliseconds: page.foldDeadlineMs, clock: clock.now },
  });
  return { step: stepOf(run, prepared, page), work: run.work };
}

function after(state: FoldedView, at: number, { step, work }: Folded): FoldedView {
  const spent = { ...state, work: state.work + work };
  if ('view' in step) {
    return { ...spent, view: step.view, folded: state.folded + 1, lastFolded: at };
  }
  return 'stall' in step ? { ...spent, stall: { at, ...step.stall } } : { ...spent, overtime: at };
}

function isGoing({ state }: Folding): boolean {
  return state.stall === undefined && state.overtime === undefined;
}

function foldEvent(
  foldings: readonly Folding[],
  { at, event }: PlacedEvent,
  page: FoldPage,
  clock: FoldHost,
): readonly Folding[] {
  return foldings.map((folding, index) => {
    if (!isGoing(folding) || !folding.prepared.considered.has(at) || !matches(folding.prepared, event)) {
      return folding;
    }
    clock.folding(at, index);
    return { ...folding, state: after(folding.state, at, foldedStep(folding, event, page, clock)) };
  });
}

function viewsOf(foldings: readonly Folding[]): readonly FoldedView[] {
  return foldings.map(({ state }) => state);
}

export function foldPage(page: FoldPage, clock: FoldHost): FoldedPage {
  const startedAt = clock.now();
  const last = page.events.length - 1;
  let foldings: readonly Folding[] = page.views.map((view) => foldingOf(view, page.dialect, clock));
  for (const [at, event] of page.events.entries()) {
    foldings = foldEvent(foldings, { at, event }, page, clock);
    if (at < last && clock.now() - startedAt >= page.pageBudgetMs) {
      return { through: at, early: true, views: viewsOf(foldings) };
    }
  }
  return { through: last, early: false, views: viewsOf(foldings) };
}

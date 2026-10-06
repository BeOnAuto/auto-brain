import type { Json, JsonObject } from '../dsl/json.ts';
import { jsonBytesWithin, mostIssueBytes, textWithin } from '../programs/byte-sizes.ts';
import { compileProgram, type CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { Deadline, ProgramLimits, ProgramRun } from '../programs/program-running.ts';
import type { ProgramSpan } from '../programs/program-tree.ts';
import { matchingOf, preparedFilters, type Matching, type PreparedFilter, type RunTest } from './fold-filters.ts';

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
  readonly through: number;
  readonly work: number;
  readonly stall?: FoldStall;
  readonly overtime?: number;
}

export interface FoldedPage {
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
  readonly filters: readonly PreparedFilter[];
  readonly check: ViewCheck | undefined;
  readonly considered: ReadonlySet<number>;
}

interface Folding {
  readonly prepared: Prepared;
  readonly state: FoldedView;
}

type Step = { readonly view: Json } | { readonly stall: Omit<FoldStall, 'at'> } | { readonly overtime: true };

interface Folded {
  readonly step: Step;
  readonly work: number;
}

interface PlacedEvent {
  readonly at: number;
  readonly event: JsonObject;
}

interface Turns {
  readonly page: FoldPage;
  readonly host: FoldHost;
  readonly firstFoldAt: () => number | undefined;
  readonly take: () => void;
}

const anywhere: ProgramSpan | null = null;

function stalled(kind: StallKind, message: string, span: ProgramSpan | null = anywhere): Step {
  return { stall: { kind, message: textWithin(message, mostIssueBytes), span } };
}

function foldingOf({ fold, filters, view, schema, events }: FoldingView, dialect: Dialect, host: FoldHost): Folding {
  return {
    prepared: {
      compiled: compileProgram(fold, dialect),
      filters: preparedFilters(filters, dialect),
      check: schema === undefined ? undefined : host.checkOf(schema),
      considered: new Set(events),
    },
    state: { view, folded: 0, lastFolded: -1, through: -1, work: 0 },
  };
}

function answeredStep(value: Json, { check }: Prepared, page: FoldPage): Step {
  if (jsonBytesWithin(value, page.mostViewBytes) > page.mostViewBytes) {
    return stalled('size', `The view takes more than the ${page.mostViewBytes} bytes as JSON a view may`);
  }
  const refused = check?.(value);
  return refused === undefined ? { view: value } : stalled('schema', refused);
}

function exhaustedStep(run: Extract<ProgramRun, { readonly ran: 'exhausted' }>): Step {
  if (run.limit === 'deadline') {
    return { overtime: true };
  }
  return stalled(run.limit === 'work' ? 'work' : 'depth', run.issue.detail, run.issue.span);
}

function stepOf(run: ProgramRun, prepared: Prepared, page: FoldPage): Step {
  if (run.ran === 'answered') {
    return answeredStep(run.value, prepared, page);
  }
  if (run.ran === 'raised') {
    return stalled('raised', run.issue.detail, run.issue.span);
  }
  if (run.ran === 'exhausted') {
    return exhaustedStep(run);
  }
  if (run.ran === 'unanswered') {
    return stalled(run.outputs === 0 ? 'none' : 'several', `The fold gave ${run.outputs} outputs`);
  }
  return stalled('unfit', 'The fold gave a number JSON cannot carry, such as nan or infinite');
}

function deadlineOf(turnStartedAt: number, { page, host }: Turns): Deadline {
  return { milliseconds: Math.max(0, turnStartedAt + page.foldDeadlineMs - host.now()), clock: host.now };
}

function foldedStep({ prepared, state }: Folding, event: JsonObject, turns: Turns, turnStartedAt: number): Folded {
  if ('issues' in prepared.compiled) {
    const [{ detail, span }] = prepared.compiled.issues;
    return { step: stalled('refused', `The fold does not compile on this server: ${detail}`, span), work: 0 };
  }
  const run = prepared.compiled.program.run(state.view, {
    limits: turns.page.limits,
    outputs: 'exactly one',
    variables: { [turns.page.variable]: event },
    deadline: deadlineOf(turnStartedAt, turns),
  });
  return { step: stepOf(run, prepared, turns.page), work: run.work };
}

function matchedStep(matching: Exclude<Matching, { readonly matched: boolean }>): Folded {
  if ('refused' in matching) {
    const [{ detail, span }] = matching.refused.issues;
    return { step: stalled('refused', `A filter does not compile on this server: ${detail}`, span), work: 0 };
  }
  return { step: exhaustedStep(matching.exhausted), work: matching.work };
}

function after(state: FoldedView, at: number, { step, work }: Folded): FoldedView {
  const spent = { ...state, through: at, work: state.work + work };
  if ('view' in step) {
    return { ...spent, view: step.view, folded: state.folded + 1, lastFolded: at };
  }
  return 'stall' in step ? { ...spent, stall: { at, ...step.stall } } : { ...spent, overtime: at };
}

function turnOf(folding: Folding, { at, event }: PlacedEvent, turns: Turns): FoldedView {
  const turnStartedAt = turns.host.now();
  const runTest: RunTest = (test, actual) =>
    test.program.run(actual, {
      limits: turns.page.limits,
      outputs: 'first',
      deadline: deadlineOf(turnStartedAt, turns),
    });
  const matching = matchingOf(folding.prepared.filters, event, runTest);
  if (!('matched' in matching)) {
    return after(folding.state, at, matchedStep(matching));
  }
  if (!matching.matched) {
    return { ...folding.state, through: at, work: folding.state.work + matching.work };
  }
  const folded = foldedStep(folding, event, turns, turnStartedAt);
  return after(folding.state, at, { step: folded.step, work: folded.work + matching.work });
}

function isGoing({ state }: Folding): boolean {
  return state.stall === undefined && state.overtime === undefined;
}

function isSpent({ page, host, firstFoldAt }: Turns): boolean {
  const first = firstFoldAt();
  return first !== undefined && host.now() - first >= page.pageBudgetMs;
}

interface EventFolded {
  readonly foldings: readonly Folding[];
  readonly early: boolean;
}

function foldEvent(foldings: readonly Folding[], placed: PlacedEvent, turns: Turns): EventFolded {
  const next: Folding[] = [];
  for (const [index, folding] of foldings.entries()) {
    if (!isGoing(folding) || !folding.prepared.considered.has(placed.at)) {
      next.push({ ...folding, state: { ...folding.state, through: placed.at } });
    } else if (isSpent(turns)) {
      return { foldings: [...next, ...foldings.slice(index)], early: true };
    } else {
      turns.take();
      turns.host.folding(placed.at, index);
      next.push({ ...folding, state: turnOf(folding, placed, turns) });
    }
  }
  return { foldings: next, early: false };
}

function viewsOf(foldings: readonly Folding[]): readonly FoldedView[] {
  return foldings.map(({ state }) => state);
}

function turnsOf(page: FoldPage, host: FoldHost): Turns {
  const first: { at?: number } = {};
  return {
    page,
    host,
    firstFoldAt: () => first.at,
    take: () => {
      first.at ??= host.now();
    },
  };
}

export function foldPage(page: FoldPage, host: FoldHost): FoldedPage {
  const turns = turnsOf(page, host);
  let foldings: readonly Folding[] = page.views.map((view) => foldingOf(view, page.dialect, host));
  for (const [at, event] of page.events.entries()) {
    const folded = foldEvent(foldings, { at, event }, turns);
    foldings = folded.foldings;
    if (folded.early) {
      return { early: true, views: viewsOf(foldings) };
    }
  }
  return { early: false, views: viewsOf(foldings) };
}

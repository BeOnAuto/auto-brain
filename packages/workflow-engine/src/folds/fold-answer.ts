import { isJson, isList, isObject, type Json, type JsonObject } from '../dsl/json.ts';
import { foldPage, type FoldHost, type FoldingView, type FoldPage, type FoldedPage } from '../folds/fold-page.ts';
import type { Dialect, Refusal } from '../programs/program-dialect.ts';
import type { ProgramLimits } from '../programs/program-running.ts';
import { fieldOf, listOf, textOf } from '../programs/program-tree.ts';
import type { FoldAnswerSchema } from './fold-messages.ts';

type FoldAnswerData = typeof FoldAnswerSchema.Encoded;

export interface FoldPageData {
  readonly events: string;
  readonly views: readonly (Omit<FoldingView, 'view'> & { readonly view: string })[];
  readonly dialect: Dialect;
  readonly variable: string;
  readonly limits: ProgramLimits;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
}

const unreadable: FoldAnswerData = { ran: 'unreadable' };

function numberOf(data: unknown, name: string): number {
  const value = fieldOf(data, name);
  return typeof value === 'number' ? value : Number.NaN;
}

function jsonOf(value: unknown): Json | undefined {
  return isJson(value) ? value : undefined;
}

function jsonIn(text: string): Json | undefined {
  try {
    return jsonOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function objectsIn(value: Json | undefined): readonly JsonObject[] | undefined {
  return isList(value) && value.every((item) => isObject(item)) ? value.filter((item) => isObject(item)) : undefined;
}

function dialectOf(data: unknown): Dialect {
  const refused = listOf(data, 'refused').map((refusal): Refusal => ({
    name: textOf(refusal, 'name'),
    why: textOf(refusal, 'why'),
  }));
  const variables = fieldOf(data, 'variables');
  return Array.isArray(variables) ? { refused, variables: variables.map(String) } : { refused };
}

function limitsOf(data: unknown): ProgramLimits {
  return {
    mostWork: numberOf(data, 'mostWork'),
    mostSteps: numberOf(data, 'mostSteps'),
    mostDepth: numberOf(data, 'mostDepth'),
    mostOutputs: numberOf(data, 'mostOutputs'),
    mostValueDepth: numberOf(data, 'mostValueDepth'),
  };
}

function viewOf(data: unknown): FoldingView | undefined {
  const view = jsonIn(textOf(data, 'view'));
  const filters = objectsIn(jsonOf(listOf(data, 'filters')));
  const schema = jsonOf(fieldOf(data, 'schema'));
  if (view === undefined || filters === undefined) {
    return undefined;
  }
  return {
    fold: textOf(data, 'fold'),
    filters,
    view,
    ...(isObject(schema) ? { schema } : {}),
    events: listOf(data, 'events').filter((index) => typeof index === 'number'),
  };
}

function pageOf(data: unknown): FoldPage | undefined {
  const events = objectsIn(jsonIn(textOf(data, 'events')));
  const views = listOf(data, 'views').map((view) => viewOf(view));
  const known = views.filter((view) => view !== undefined);
  if (events === undefined || known.length < views.length) {
    return undefined;
  }
  return {
    events,
    views: known,
    dialect: dialectOf(fieldOf(data, 'dialect')),
    variable: textOf(data, 'variable'),
    limits: limitsOf(fieldOf(data, 'limits')),
    foldDeadlineMs: numberOf(data, 'foldDeadlineMs'),
    pageBudgetMs: numberOf(data, 'pageBudgetMs'),
    mostViewBytes: numberOf(data, 'mostViewBytes'),
  };
}

export function foldPageData({ events, views, ...rest }: FoldPage): FoldPageData {
  return {
    ...rest,
    events: JSON.stringify(events),
    views: views.map(({ view, ...each }) => ({ ...each, view: JSON.stringify(view) })),
  };
}

function answerFrom({ early, views }: FoldedPage): FoldAnswerData {
  return {
    ran: 'folded',
    early,
    views: views.map(({ view, ...rest }) => ({ ...rest, view: JSON.stringify(view) })),
  };
}

export function foldAnswerOf(data: unknown, host: FoldHost): FoldAnswerData {
  const page = pageOf(data);
  return page === undefined ? unreadable : answerFrom(foldPage(page, host));
}

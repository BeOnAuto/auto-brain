import { Predicate } from 'effect';

export interface ListedModel {
  readonly id: string;
  readonly created: number;
  readonly name?: string;
  readonly context_window?: number;
  readonly max_tokens?: number;
}

export interface ReportedDetails {
  readonly created?: unknown;
  readonly name?: unknown;
  readonly context_window?: unknown;
  readonly max_tokens?: unknown;
}

function secondsOf(created: unknown): number {
  return Predicate.isNumber(created) && Number.isFinite(created) && created > 0 ? Math.floor(created) : 0;
}

function countOf(value: unknown): number | undefined {
  return Predicate.isNumber(value) && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function contextWindowOf(value: unknown): { readonly context_window?: number } {
  const count = countOf(value);
  return count === undefined ? {} : { context_window: count };
}

function maxTokensOf(value: unknown): { readonly max_tokens?: number } {
  const count = countOf(value);
  return count === undefined ? {} : { max_tokens: count };
}

function nameOf(name: unknown): { readonly name?: string } {
  return Predicate.isString(name) && name.trim() !== '' ? { name: name.trim() } : {};
}

export function listedModel(id: string, { created, name, context_window, max_tokens }: ReportedDetails): ListedModel {
  return {
    id,
    created: secondsOf(created),
    ...nameOf(name),
    ...contextWindowOf(context_window),
    ...maxTokensOf(max_tokens),
  };
}

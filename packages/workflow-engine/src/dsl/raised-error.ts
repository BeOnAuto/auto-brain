import type { Settlement } from '@beonauto/operations';

import type { DslError } from '../machine/dsl-error.ts';
import { mostOutputBytes } from '../machine/limits.ts';
import { field, jsonBytesOf, textField, type Json, type JsonObject } from './json.ts';

export type ErrorKind =
  | 'configuration'
  | 'validation'
  | 'expression'
  | 'authentication'
  | 'authorization'
  | 'timeout'
  | 'communication'
  | 'runtime';

export class RaisedError extends Error {
  readonly error: DslError;

  constructor(error: DslError) {
    super(error.title ?? error.type);
    this.name = 'RaisedError';
    this.error = error;
  }
}

export type SettledOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled' | 'broken' | 'oversized' | 'overran' };

export function caughtRaise<A>(attempt: () => A, onRaise: (error: DslError) => A): A {
  try {
    return attempt();
  } catch (error) {
    if (!(error instanceof RaisedError)) {
      throw error;
    }
    return onRaise(error.error);
  }
}

const standardErrorTypes = 'https://open-workflow-specification.org/spec/1.0.0/errors/';

export function errorType(kind: ErrorKind): string {
  return `${standardErrorTypes}${kind}`;
}

export function raised(kind: ErrorKind, status: number, title: string, instance: string): RaisedError {
  return new RaisedError({ type: errorType(kind), status, title, instance });
}

export function errorAsJson({ type, status, instance, title, detail, kind, because }: DslError): JsonObject {
  return {
    type,
    status,
    instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
  };
}

export function errorFromJson(definition: JsonObject, instance: string): DslError | undefined {
  const type = textField(definition, 'type');
  const status = field(definition, 'status');
  if (type === undefined || typeof status !== 'number' || !Number.isInteger(status)) {
    return undefined;
  }
  const title = textField(definition, 'title');
  const detail = textField(definition, 'detail');
  return {
    type,
    status,
    instance: textField(definition, 'instance') ?? instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
  };
}

export function describeError({ type, title, detail, instance }: DslError): string {
  return `${title ?? type}${detail === undefined ? '' : `: ${detail}`} (at ${instance})`;
}

const retryableStatuses: ReadonlySet<number> = new Set([408, 429]);

export function rejectionReasonOf({ status }: DslError): 'invalid_input' | 'unavailable' {
  return status >= 400 && status < 500 && !retryableStatuses.has(status) ? 'invalid_input' : 'unavailable';
}

export type OutputOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'oversized'; readonly bytes: number; readonly most: number };

export function outcomeOfOutput(output: Json): OutputOutcome {
  const bytes = jsonBytesOf(output);
  return bytes > mostOutputBytes ? { kind: 'oversized', bytes, most: mostOutputBytes } : { kind: 'completed', output };
}

export function settlementOf(outcome: SettledOutcome): Settlement {
  if (outcome.kind === 'completed') {
    return { status: 'succeeded', output: outcome.output };
  }
  return outcome.kind === 'raised'
    ? { status: 'rejected', reason: rejectionReasonOf(outcome.error), detail: describeError(outcome.error) }
    : { status: 'failed' };
}

interface RejectedCall {
  readonly status: 'rejected';
  readonly reason: string;
  readonly detail: string;
  readonly kind?: string;
  readonly because?: string;
}

export type FailedCall =
  | RejectedCall
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'unreachable'; readonly detail: string };

export interface CallSite {
  readonly function: string;
  readonly label: string;
  readonly reference: string;
}

type Classification = readonly [ErrorKind, number];

const rejections: Readonly<Record<string, Classification>> = {
  invalid_input: ['validation', 400],
  forbidden: ['authorization', 403],
  not_found: ['configuration', 404],
  conflict: ['runtime', 409],
  unavailable: ['communication', 503],
};

function kindAndBecauseOf({ kind, because }: RejectedCall): Pick<DslError, 'kind' | 'because'> {
  return { ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function callErrorOf(result: FailedCall, call: CallSite): DslError {
  if (result.status === 'unreachable') {
    return {
      type: errorType('communication'),
      status: 503,
      title: `${call.function} could not reach ${call.label}`,
      detail: result.detail,
      instance: call.reference,
    };
  }
  const [kind, status]: Classification =
    result.status === 'rejected' ? (rejections[result.reason] ?? ['runtime', 500]) : ['runtime', 500];
  return {
    type: errorType(kind),
    status,
    title:
      result.status === 'rejected'
        ? `${capitalized(call.label)} rejected the execution with ${result.reason}`
        : `${capitalized(call.label)} failed`,
    detail: result.detail,
    instance: call.reference,
    ...(result.status === 'rejected' ? kindAndBecauseOf(result) : {}),
  };
}

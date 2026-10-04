import { field, textField, type JsonObject } from '@beonauto/workflow-engine/dsl/json';

export type ErrorKind =
  | 'configuration'
  | 'validation'
  | 'expression'
  | 'authentication'
  | 'authorization'
  | 'timeout'
  | 'communication'
  | 'runtime';

export interface DslError {
  readonly type: string;
  readonly status: number;
  readonly instance: string;
  readonly title?: string;
  readonly detail?: string;
}

export class RaisedError extends Error {
  readonly error: DslError;

  constructor(error: DslError) {
    super(error.title ?? error.type);
    this.name = 'RaisedError';
    this.error = error;
  }
}

const standardErrorTypes = 'https://open-workflow-specification.org/spec/1.0.0/errors/';

export function errorType(kind: ErrorKind): string {
  return `${standardErrorTypes}${kind}`;
}

export function raised(kind: ErrorKind, status: number, title: string, instance: string): RaisedError {
  return new RaisedError({ type: errorType(kind), status, title, instance });
}

export function errorAsJson({ type, status, instance, title, detail }: DslError): JsonObject {
  return {
    type,
    status,
    instance,
    ...(title === undefined ? {} : { title }),
    ...(detail === undefined ? {} : { detail }),
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

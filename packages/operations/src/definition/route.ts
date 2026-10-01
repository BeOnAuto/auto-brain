import type { OperationKind } from '../caller/operation-scope.ts';

export type Method = 'GET' | 'POST' | 'PUT';

interface MethodsByKind {
  readonly query: 'GET';
  readonly command: 'POST' | 'PUT';
}

export interface Route<K extends OperationKind = OperationKind, P extends string = string> {
  readonly method: MethodsByKind[K];
  readonly path: P;
}

export type PathParameters<P extends string> = P extends `${string}{${infer Parameter}}${infer Rest}`
  ? Parameter | PathParameters<Rest>
  : never;

const pathGrammar = /^(?:\/(?:[a-z0-9][a-z0-9_-]*|\{[A-Za-z][A-Za-z0-9_]*\}))+$/u;

export function pathParametersOf(path: string): readonly string[] {
  const parameters = path
    .split('/')
    .filter((segment) => segment.startsWith('{'))
    .map((segment) => segment.slice(1, -1));
  if (!pathGrammar.test(path) || new Set(parameters).size !== parameters.length) {
    throw new Error(`The route path ${path} is malformed`);
  }
  return parameters;
}

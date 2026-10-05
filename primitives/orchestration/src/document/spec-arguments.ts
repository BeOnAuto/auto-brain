import { type ErrorKind, field, isObject, type Json, jsonBytesOf, textField } from '@beonauto/workflow-engine';

import { executeSpecFunction } from './workflow-functions.ts';

export interface SpecArguments {
  readonly primitive: string;
  readonly name: string;
  readonly input: Json;
}

export interface ArgumentsProblem {
  readonly kind: ErrorKind;
  readonly title: string;
}

const mostSpecInputBytes = 262_144;

export function specArgumentsOf(arguments_: Json): SpecArguments | ArgumentsProblem {
  if (!isObject(arguments_)) {
    return { kind: 'validation', title: `${executeSpecFunction} takes with: { primitive, name, input }` };
  }
  const primitive = textField(arguments_, 'primitive');
  const name = textField(arguments_, 'name');
  if (primitive === undefined || name === undefined) {
    return { kind: 'validation', title: `${executeSpecFunction} needs a string primitive and a string name` };
  }
  if (primitive === 'orchestration') {
    return { kind: 'configuration', title: 'A workflow cannot execute another workflow in this version' };
  }
  const input = field(arguments_, 'input') ?? {};
  const bytes = jsonBytesOf(input);
  return bytes > mostSpecInputBytes
    ? {
        kind: 'validation',
        title: `The input of ${executeSpecFunction} takes ${bytes} bytes as JSON, more than the ${mostSpecInputBytes} an execution takes`,
      }
    : { primitive, name, input };
}

export function isArgumentsProblem(value: SpecArguments | ArgumentsProblem): value is ArgumentsProblem {
  return 'title' in value;
}

export function failureChain(error: unknown): string {
  return error instanceof Error && error.cause !== undefined
    ? `${String(error)}: ${failureChain(error.cause)}`
    : String(error);
}

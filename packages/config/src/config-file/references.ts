import type { Schema } from 'effect';

import type { Environment } from '../server-config.ts';
import { below, entriesOf, type FileProblem, type JsonEntry } from './file-problem.ts';

export interface Substituted {
  readonly value: Schema.Json;
  readonly problems: readonly FileProblem[];
}

interface Resolution {
  readonly text: string;
  readonly problem: string | undefined;
}

interface EntrySubstitution {
  readonly key: string;
  readonly result: Substituted;
}

const pieces = /(\$\$|\$\{[^}]*\})/u;

const environmentReference = /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/u;

const notAReference =
  'Holds a ${…} that is not a reference to an environment variable; write ${NAME}, or $$ for a literal $';

function piecesOf(text: string): readonly string[] {
  return text.split(pieces).filter((piece) => piece !== '');
}

function isReference(piece: string): boolean {
  return piece.startsWith('${');
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function plain(piece: string): Resolution {
  return { text: piece, problem: undefined };
}

function failed(problem: string): Resolution {
  return { text: '', problem };
}

function resolved(piece: string, environment: Environment): Resolution {
  if (piece === '$$') {
    return plain('$');
  }
  if (!isReference(piece)) {
    return plain(piece);
  }
  const reference = environmentReference.exec(piece);
  if (reference === null) {
    return failed(notAReference);
  }
  const [, name = '', fallback] = reference;
  const value = environment[name];
  if (isSet(value)) {
    return plain(value);
  }
  return fallback === undefined
    ? failed(`Refers to the environment variable ${name}, which is not set`)
    : plain(fallback);
}

function substitutedText(textWithReferences: string, pointer: string, environment: Environment): Substituted {
  const resolutions = piecesOf(textWithReferences).map((piece) => resolved(piece, environment));
  return {
    value: resolutions.map((resolution) => resolution.text).join(''),
    problems: resolutions.flatMap(({ problem }) => (problem === undefined ? [] : [{ pointer, detail: problem }])),
  };
}

export function literalTextOf(textWithReferences: string): string {
  return piecesOf(textWithReferences)
    .filter((piece) => !isReference(piece))
    .join('');
}

export function holdsReference(textWithReferences: string): boolean {
  return piecesOf(textWithReferences).some((piece) => environmentReference.test(piece));
}

export function substituted(value: Schema.Json, pointer: string, environment: Environment): Substituted {
  if (typeof value === 'string') {
    return substitutedText(value, pointer, environment);
  }
  const results = entriesOf(value).map(([key, item]): EntrySubstitution => ({
    key,
    result: substituted(item, below(pointer, key), environment),
  }));
  const entries = results.map(({ key, result }: EntrySubstitution): JsonEntry => [key, result.value]);
  const problems = results.flatMap(({ result }: EntrySubstitution) => result.problems);
  if (Array.isArray(value)) {
    return { value: entries.map(([, item]) => item), problems };
  }
  return typeof value === 'object' && value !== null
    ? { value: Object.fromEntries(entries), problems }
    : { value, problems };
}

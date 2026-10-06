import type { Schema } from 'effect';

import { below, entriesOf, type FileProblem } from './file-problem.ts';
import { holdsReference, literalTextOf } from './references.ts';

const credentialWords: ReadonlySet<string> = new Set([
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'token',
]);

const credentialPairs = /(?:^|-)(?:api|access|private|secret)-key(?:-|$)/u;

const credentialShapes: readonly RegExp[] = [
  /^(?:basic|bearer|digest|token)\s+\S/iu,
  /^sk-[\w-]{16,}/u,
  /^[rs]k[-_](?:live|test)[-_]\w/u,
  /^AKIA[0-9A-Z]{16}$/u,
  /^AIza[\w-]{35}$/u,
  /^gh[opsu]_\w{20,}/u,
  /^github_pat_\w+/u,
  /^xox[abprs]-/u,
  /^abk_[a-z0-9-]+_[\w-]{43}$/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

const advice =
  'Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}';

function namesCredential(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/u);
  return (
    name.toLowerCase() === 'key' ||
    words.some((word) => credentialWords.has(word)) ||
    credentialPairs.test(words.join('-'))
  );
}

function looksLikeCredential(text: string): boolean {
  const literal = literalTextOf(text).trim();
  return credentialShapes.some((shape: Readonly<RegExp>) => shape.test(literal));
}

function urlHoldsCredential(text: string): boolean {
  const url = URL.parse(literalTextOf(text).trim());
  if (url === null) {
    return false;
  }
  return (
    url.password !== '' ||
    looksLikeCredential(url.username) ||
    [...url.searchParams.values()].some((value) => looksLikeCredential(value))
  );
}

function assignsCredential(text: string): boolean {
  const equals = text.indexOf('=');
  return equals >= 0 && looksLikeCredential(text.slice(equals + 1));
}

function textProblems(name: string, text: string, pointer: string): readonly FileProblem[] {
  const refused =
    (namesCredential(name) && !holdsReference(text)) ||
    looksLikeCredential(text) ||
    urlHoldsCredential(text) ||
    assignsCredential(text);
  return refused ? [{ pointer, detail: advice }] : [];
}

export function credentialProblems(name: string, value: Schema.Json, pointer: string): readonly FileProblem[] {
  if (typeof value === 'string') {
    return textProblems(name, value, pointer);
  }
  const isList = Array.isArray(value);
  return entriesOf(value).flatMap(([key, item]) => credentialProblems(isList ? name : key, item, below(pointer, key)));
}

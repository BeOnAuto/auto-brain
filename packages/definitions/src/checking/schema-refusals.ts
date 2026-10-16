import type { Breach, CompiledSchema, FoundIssue } from '@on.auto/json-schema';
import { asSentence, InvalidInput, type Issue } from '@on.auto/operations';
import { JsonPointer, type Schema } from 'effect';

import type { Phrases } from '../overview/overview.ts';
import { trailingWords } from '../overview/schema-bounds.ts';
import {
  isItemOf,
  listOf,
  placeAt,
  type JsonSchema,
  type PlaceStep,
  type SchemaPlace,
} from '../overview/schema-reading.ts';
import { descriptionOf, examplesWordsOf, expectedWordsOf } from '../overview/schema-words.ts';

const kindKeywords = ['type', 'enum', 'const', 'anyOf', 'oneOf', 'properties', 'items', 'prefixItems'];

function withoutFullStop(text: string): string {
  return text.trim().replace(/\.$/u, '');
}

function asPhrase(words: string): string {
  const phrase = withoutFullStop(words);
  return `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
}

function plainText(phrases: Phrases): string {
  return phrases.map((phrase) => (typeof phrase === 'string' ? phrase : Object.values(phrase).join(''))).join('');
}

function tokensOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

function nameOf(step: PlaceStep): string {
  return isItemOf(step) ? `item ${Number(step.token) + 1}` : step.token;
}

function describedIn(schema: JsonSchema): readonly string[] {
  const description = descriptionOf(schema);
  return description === undefined ? [] : [description];
}

function aboutOf(schemas: readonly JsonSchema[]): string {
  const [description] = schemas.flatMap((schema) => describedIn(schema));
  const examples = schemas.flatMap((schema) => listOf(schema, 'examples'));
  return [
    ...(description === undefined ? [] : [withoutFullStop(description)]),
    ...examplesWordsOf(examples, description),
  ]
    .map((part) => `, ${part}`)
    .join('');
}

function subjectOf({ steps, schemas }: SchemaPlace, what: string): string {
  return steps.length === 0 ? `The ${what}` : `${steps.map((step) => nameOf(step)).join(', then ')}${aboutOf(schemas)}`;
}

function missingWords(step: PlaceStep): string {
  return isItemOf(step) ? nameOf(step) : `the field ${step.token}`;
}

function refusedWords(steps: readonly PlaceStep[]): string {
  const [step] = steps.slice(-1);
  if (step === undefined) {
    return 'no value';
  }
  return isItemOf(step) ? `no ${nameOf(step)}` : `no field ${step.token}`;
}

function kindWords({ schemas }: SchemaPlace, root: JsonSchema, detail: string): string {
  const said = schemas.find((schema) => kindKeywords.some((keyword) => schema[keyword] !== undefined));
  return said === undefined ? asPhrase(detail) : `expected ${plainText(expectedWordsOf(said, root))}`;
}

function holderSentence({ document, what }: CompiledSchema, tokens: readonly string[], breach: Breach): string {
  const place = placeAt(document, tokens);
  const holder = subjectOf(placeAt(document, tokens.slice(0, -1)), what);
  if (breach.rule === 'unexpected') {
    return `${holder}: expected ${refusedWords(place.steps)}`;
  }
  const missing = place.steps.slice(-1).map((step) => missingWords(step));
  return `${holder}: expected ${missing.join('')}${aboutOf(place.schemas)}`;
}

function valueSentence({ document, what }: CompiledSchema, tokens: readonly string[], breach: Breach, detail: string) {
  const place = placeAt(document, tokens);
  return breach.rule === 'bound'
    ? `${subjectOf(place, what)}: expected ${trailingWords(breach.keywords, []).join(', ')}`
    : `${subjectOf(place, what)}: ${kindWords(place, document, detail)}`;
}

function breachSentence(schema: CompiledSchema, tokens: readonly string[], breach: Breach, detail: string): string {
  return breach.rule === 'missing' || breach.rule === 'unexpected'
    ? holderSentence(schema, tokens, breach)
    : valueSentence(schema, tokens, breach, detail);
}

function sentenceOf(schema: CompiledSchema, { pointer, detail, breach }: FoundIssue): string {
  const tokens = tokensOf(pointer);
  if (breach !== undefined) {
    return breachSentence(schema, tokens, breach, detail);
  }
  return pointer === '' ? detail : `${subjectOf(placeAt(schema.document, tokens), schema.what)}: ${asPhrase(detail)}`;
}

export function wordedIssuesOf(schema: CompiledSchema, value: Schema.Json): readonly Issue[] {
  return schema
    .issuesOf(value)
    .map((issue) => ({ pointer: issue.pointer, detail: asSentence(sentenceOf(schema, issue)) }));
}

export function refusedInput(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: issues.map(({ detail }) => detail).join(' '), issues });
}

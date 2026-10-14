import { asSentence } from '@on.auto/operations';
import type { Schema } from 'effect';

import { inWords } from '../plain-language/in-words.ts';
import { named, paragraph, type OverviewBlock, type Phrase, type Phrases } from './overview.ts';
import {
  deeper,
  isJsonList,
  isJsonSchema,
  listOf,
  mostSchemaDepth,
  numberOf,
  propertiesOf,
  requiredOf,
  resolvedSchema,
  textOf,
  typesOf,
  type JsonSchema,
  type SchemaReading,
} from './schema-reading.ts';

type Count = 'one' | 'other';

interface Noun {
  readonly one: string;
  readonly other: string;
}

type Words = readonly [string, ...Phrase[]];

interface Bound {
  readonly low: string;
  readonly high: string;
  readonly from: string;
  readonly unit?: Noun;
}

const text: Noun = { one: 'text', other: 'text' };

const nouns: Readonly<Record<string, Noun>> = {
  integer: { one: 'a whole number', other: 'whole numbers' },
  number: { one: 'a number', other: 'numbers' },
  boolean: { one: 'yes or no', other: 'yes-or-no values' },
  null: { one: 'nothing', other: 'empty values' },
};

const dateAndTime: Noun = { one: 'a date and time', other: 'dates and times' };

const list: Noun = { one: 'a list', other: 'lists' };

const record: Noun = { one: 'a record', other: 'records' };

const anyValue: Noun = { one: 'any value', other: 'any values' };

const bounds: readonly Bound[] = [
  { low: 'minimum', high: 'maximum', from: 'from ' },
  { low: 'minLength', high: 'maxLength', from: '', unit: { one: 'character', other: 'characters' } },
  { low: 'minItems', high: 'maxItems', from: '', unit: { one: 'item', other: 'items' } },
  { low: 'minProperties', high: 'maxProperties', from: '', unit: { one: 'entry', other: 'entries' } },
];

export const mostFieldDescriptionCharacters = 300;

const mostNamedValues = 12;

const mostNamedFields = 12;

const mostAlternatives = 4;

const counted = new Intl.NumberFormat('en');

function valueText(value: Schema.Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function andMore(shown: readonly string[], total: number): string {
  return [...shown, ...(total > shown.length ? [`and ${total - shown.length} more`] : [])].join(', ');
}

function choiceWords(schema: JsonSchema, count: Count): Words | undefined {
  const values = schema['enum'];
  const constant = schema['const'];
  if (isJsonList(values)) {
    const listed = andMore(
      values.slice(0, mostNamedValues).map((value) => valueText(value)),
      values.length,
    );
    return [count === 'one' ? `one of: ${listed}` : `values, each one of: ${listed}`];
  }
  if (constant !== undefined) {
    return [count === 'one' ? `exactly ${valueText(constant)}` : `values, each exactly ${valueText(constant)}`];
  }
  return undefined;
}

function joined([first, ...rest]: readonly [Words, ...Words[]], separator: string): Words {
  return [first[0], ...first.slice(1), ...rest.flatMap((words) => [separator, ...words])];
}

function alternativeWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words | undefined {
  const anyOf = listOf(schema, 'anyOf');
  const members = (anyOf.length > 0 ? anyOf : listOf(schema, 'oneOf')).filter((member) => isJsonSchema(member));
  const [first, ...rest] = members.map((member) => wordsOf(member, deeper(reading), count));
  if (first === undefined) {
    return undefined;
  }
  if (members.length > mostAlternatives) {
    return [count === 'one' ? `one of ${members.length} kinds of value` : `values of ${members.length} kinds`];
  }
  return joined([first, ...rest], ' or ');
}

function descriptionOf(schema: JsonSchema): string | undefined {
  const description = textOf(schema, 'description')?.trim();
  if (description === undefined || description === '') {
    return undefined;
  }
  const characters = Array.from(description);
  return characters.length <= mostFieldDescriptionCharacters
    ? description
    : `${characters.slice(0, mostFieldDescriptionCharacters).join('')}…`;
}

function subFieldPhrases(name: string, property: JsonSchema, required: boolean, reading: SchemaReading): Phrases {
  const description = descriptionOf(resolvedSchema(property, reading).schema);
  return [
    named(name),
    ' (',
    ...(description === undefined ? [] : [`${description}; `]),
    ...wordsOf(property, reading, 'one'),
    required ? ')' : ', optional)',
  ];
}

function entryWords(entries: JsonSchema, reading: SchemaReading, count: Count): Words {
  const [first, ...rest] = wordsOf(entries, deeper(reading), 'one');
  return [`${record[count]} whose every entry is ${first}`, ...rest];
}

function recordWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const properties = propertiesOf(schema);
  const entries = schema['additionalProperties'];
  if (!reading.expanded && properties.length === 0 && isJsonSchema(entries)) {
    return entryWords(entries, reading, count);
  }
  if (reading.expanded || properties.length === 0) {
    return [record[count]];
  }
  const required = requiredOf(schema);
  const fields = properties
    .slice(0, mostNamedFields)
    .map(([name, property]) => subFieldPhrases(name, property, required.has(name), deeper(reading, true)));
  const more = properties.length - fields.length;
  const listed: Phrase[] = [];
  for (const [index, field] of fields.entries()) {
    listed.push(...(index > 0 ? [', '] : []), ...field);
  }
  return [`${record[count]} with: `, ...listed, ...(more > 0 ? [`, and ${more} more`] : [])];
}

function listWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const items = schema['items'];
  if (!isJsonSchema(items)) {
    return [list[count]];
  }
  const [first, ...rest] = wordsOf(items, deeper(reading), 'other');
  return [`${list[count]} of ${first}`, ...rest];
}

function kindWords(kind: string, schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  switch (kind) {
    case 'array': {
      return listWords(schema, reading, count);
    }
    case 'object': {
      return recordWords(schema, reading, count);
    }
    case 'string': {
      return [(textOf(schema, 'format') === 'date-time' ? dateAndTime : text)[count]];
    }
    default: {
      return [(nouns[kind] ?? anyValue)[count]];
    }
  }
}

function impliedKinds(schema: JsonSchema): readonly [string, ...string[]] {
  if (isJsonSchema(schema['properties'])) {
    return ['object'];
  }
  return isJsonSchema(schema['items']) ? ['array'] : ['any'];
}

function kindsWords(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  const [first, ...rest] = typesOf(schema);
  const kinds = first === undefined ? impliedKinds(schema) : [first, ...rest];
  const [firstKind, ...otherKinds] = kinds;
  return joined(
    [
      kindWords(firstKind, schema, reading, count),
      ...otherKinds.map((kind) => kindWords(kind, schema, reading, count)),
    ],
    ' or ',
  );
}

function unitOf(amount: number, unit: Noun | undefined): string {
  if (unit === undefined) {
    return '';
  }
  return ` ${amount === 1 ? unit.one : unit.other}`;
}

function boundWords(schema: JsonSchema, { low, high, from, unit }: Bound): readonly string[] {
  const least = numberOf(schema, low);
  const most = numberOf(schema, high);
  if (least !== undefined && most !== undefined) {
    return [`${from}${counted.format(least)} to ${counted.format(most)}${unitOf(most, unit)}`];
  }
  if (least !== undefined) {
    return [`at least ${counted.format(least)}${unitOf(least, unit)}`];
  }
  return most === undefined ? [] : [`at most ${counted.format(most)}${unitOf(most, unit)}`];
}

function exclusiveWords(schema: JsonSchema): readonly string[] {
  const above = numberOf(schema, 'exclusiveMinimum');
  const below = numberOf(schema, 'exclusiveMaximum');
  return [
    ...(above === undefined ? [] : [`more than ${counted.format(above)}`]),
    ...(below === undefined ? [] : [`less than ${counted.format(below)}`]),
  ];
}

function defaultWords(schema: JsonSchema): readonly string[] {
  const value = schema['default'];
  return value === undefined ? [] : [`${inWords(value) ?? 'a default'} when left out`];
}

function wordsOf(schema: JsonSchema, reading: SchemaReading, count: Count): Words {
  if (reading.depth > mostSchemaDepth) {
    return [anyValue[count]];
  }
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  const choice = choiceWords(read, count);
  const [first, ...rest] = choice ?? alternativeWords(read, within, count) ?? kindsWords(read, within, count);
  const separator = choice === undefined ? ', ' : '; ';
  const extra = [...bounds.flatMap((bound) => boundWords(read, bound)), ...exclusiveWords(read), ...defaultWords(read)];
  return [first, ...rest, ...extra.map((words) => `${separator}${words}`)];
}

function capitalized([first, ...rest]: Words): Words {
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest];
}

function fieldWords(property: JsonSchema, reading: SchemaReading): Phrases {
  const description = descriptionOf(resolvedSchema(property, reading).schema);
  return [
    ...(description === undefined ? [] : [`${asSentence(description)} `]),
    ...capitalized(wordsOf(property, reading, 'one')),
    '.',
  ];
}

export function schemaBlocks(schema: JsonSchema | undefined, unknown: string): readonly OverviewBlock[] {
  if (schema === undefined) {
    return [paragraph(unknown)];
  }
  const reading: SchemaReading = { root: schema, depth: 0, expanded: false };
  const { schema: read, reading: within } = resolvedSchema(schema, reading);
  const description = descriptionOf(read);
  const opening = description === undefined ? [] : [paragraph(asSentence(description))];
  const properties = propertiesOf(read);
  if (properties.length === 0) {
    return [...opening, paragraph(...capitalized(wordsOf(schema, reading, 'one')), '.')];
  }
  const required = requiredOf(read);
  const rows = properties.map(([name, property]) => ({
    name,
    required: required.has(name),
    words: fieldWords(property, deeper(within)),
  }));
  return [...opening, { kind: 'fields', rows }];
}

import { alternatives, asSentence, capitalized, counted, listed, quoted, type Noun } from '@beonauto/operations';
import { Option, Schema } from 'effect';

import type { Primitive } from '../primitive/primitive.ts';
import type { ListedDefinition } from '../registry/spec.ts';
import { wordsOf } from './in-words.ts';

const mostNamed = 20;

const propertiesOf = Schema.decodeUnknownOption(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
);

export interface SpecWords {
  readonly kinds: string;
  readonly allKinds: string;
  readonly nounOf: (primitive: string) => Noun;
  readonly named: (primitive: string, name: string) => string;
}

const unknownNoun: Noun = { one: 'item', other: 'items' };

export function specWordsFor(primitives: readonly Primitive[]): SpecWords {
  const nounOf = (name: string) => primitives.find((primitive) => primitive.name === name)?.noun ?? unknownNoun;
  return {
    kinds: alternatives(primitives.map(({ noun }) => noun.one)),
    allKinds: listed(primitives.map(({ noun }) => noun.other)),
    nounOf,
    named: (primitive, name) => `the ${nounOf(primitive).one} ${quoted(name)}`,
  };
}

function propertyWordsOf(schema: Schema.JsonObject | undefined): readonly string[] {
  return Option.match(propertiesOf(schema), {
    onNone: () => [],
    onSome: ({ properties }) => Object.keys(properties).map((name) => wordsOf(name)),
  });
}

function takesAndGives(inputs: readonly string[], outputs: readonly string[]): string {
  const gives = outputs.length === 0 ? '' : `gives back ${listed(outputs)}`;
  if (inputs.length === 0) {
    return gives === '' ? '' : ` It ${gives}.`;
  }
  return ` It takes ${listed(inputs)}${gives === '' ? '' : `, and ${gives}`}.`;
}

export function whatItDoes(spec: Pick<ListedDefinition, 'description' | 'input_schema' | 'output_schema'>): string {
  return spec.description === undefined
    ? takesAndGives(propertyWordsOf(spec.input_schema), propertyWordsOf(spec.output_schema))
    : ` What it does: ${asSentence(spec.description)}`;
}

export function specStanding(
  words: SpecWords,
  { primitive, name, status }: Pick<ListedDefinition, 'primitive' | 'name' | 'status'>,
): string {
  const named = capitalized(words.named(primitive, name));
  return status === 'active' ? `${named} is in use.` : `${named} has been retired; it can no longer be run or changed.`;
}

function namesOf(specs: readonly ListedDefinition[]): string {
  const named = specs.slice(0, mostNamed).map(({ name }) => quoted(name));
  const others = specs.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

export function specsListed(noun: Noun, specs: readonly ListedDefinition[]): string {
  const active = specs.filter(({ status }) => status === 'active');
  const retired = specs.filter(({ status }) => status === 'retired');
  const inUse =
    active.length === 0
      ? `This brain has no ${noun.other} in use yet.`
      : `This brain has ${counted(active.length, noun)}: ${namesOf(active)}.`;
  const retiredNoun = { one: `retired ${noun.one}`, other: `retired ${noun.other}` };
  return retired.length === 0
    ? inUse
    : `${inUse} Also listed, ${counted(retired.length, retiredNoun)}: ${namesOf(retired)}.`;
}

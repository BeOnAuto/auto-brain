import { lineageAttributeNames } from '@beonauto/operations';
import { Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionEvent } from '../registry/definition-events.ts';
import { declaredFactsOf, ownedStreamsOf } from '../run-work/declared-facts.ts';
import { coreRunFactTypes } from '../runs/run-events.ts';
import type { EventPublished } from './published-events.ts';
import type { ReactionRefused } from './reaction-refusals.ts';

export const runSourcePrefix = '/runs/';

export const definitionSourcePrefix = '/definitions/';

export const callerSourcePrefix = '/callers/';

type BrainFeedType = DefinitionEvent['type'] | EventPublished['type'] | ReactionRefused['type'];

const brainFeedTypes: Readonly<Record<BrainFeedType, true>> = {
  definition_created: true,
  definition_updated: true,
  definition_retired: true,
  event_published: true,
  reaction_refused: true,
};

type NamingCapability = Pick<Capability, 'facts'> & Partial<Pick<Capability, 'runWords'>>;

function deferralTypesOf(capabilities: readonly NamingCapability[]): readonly string[] {
  return capabilities.flatMap(({ runWords }) => (runWords === undefined ? [] : [runWords.deferralType]));
}

function streamTypesOf(capabilities: readonly NamingCapability[]): readonly string[] {
  return ownedStreamsOf(capabilities).flatMap(({ publicNames }) => Object.values(publicNames).flat());
}

function brainTypesOf(capabilities: readonly NamingCapability[]): ReadonlySet<string> {
  return new Set([
    ...coreRunFactTypes,
    ...declaredFactsOf(capabilities).map(({ type }) => type),
    ...deferralTypesOf(capabilities),
    ...streamTypesOf(capabilities),
    ...Object.keys(brainFeedTypes),
  ]);
}

const reservedSourcePrefixes: readonly string[] = [runSourcePrefix, definitionSourcePrefix, callerSourcePrefix];

export const reservedSourcesInWords = new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(
  reservedSourcePrefixes,
);

interface Attributes {
  readonly type: string;
  readonly source?: string;
  readonly [attribute: string]: unknown;
}

export function isReservedSource(source: string): boolean {
  return reservedSourcePrefixes.some((prefix) => source.startsWith(prefix));
}

export const contextAttributeNames: readonly string[] = [
  'caller',
  'definitionversion',
  'depth',
  'calldepth',
  'calledby',
  'triggerkind',
  'triggerreference',
];

const reservedAttributeNames: readonly string[] = [...lineageAttributeNames, ...contextAttributeNames];

const reservedAttributesInWords = new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(reservedAttributeNames);

function lineageIssues(attributes: Attributes) {
  return reservedAttributeNames
    .filter((name) => Object.hasOwn(attributes, name))
    .map((name) => ({
      path: [name],
      issue: `Expected no ${name}: ${reservedAttributesInWords} are the lineage and context the brain gives its own records, which no event may claim`,
    }));
}

function brainOwnAttributesOf(types: ReadonlySet<string>) {
  const typesInWords = [...types].join(', ');
  return (attributes: Attributes) => {
    const { type, source } = attributes;
    return [
      ...lineageIssues(attributes),
      ...(types.has(type)
        ? [{ path: ['type'], issue: `Expected a type of your own, not one the brain records itself: ${typesInWords}` }]
        : []),
      ...(source !== undefined && isReservedSource(source)
        ? [
            {
              path: ['source'],
              issue: `Expected a source of your own, not one under ${reservedSourcesInWords}, which the brain records itself`,
            },
          ]
        : []),
    ];
  };
}

function refusingOf(types: ReadonlySet<string>) {
  return Schema.makeFilter(brainOwnAttributesOf(types));
}

export interface BrainOwnNames {
  readonly types: ReadonlySet<string>;
  readonly refusingTheBrainsOwnAttributes: ReturnType<typeof refusingOf>;
}

export function brainOwnNamesOf(capabilities: readonly NamingCapability[]): BrainOwnNames {
  const types = brainTypesOf(capabilities);
  return { types, refusingTheBrainsOwnAttributes: refusingOf(types) };
}

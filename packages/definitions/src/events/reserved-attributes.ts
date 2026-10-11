import type { ToolTestEvent } from '@beonauto/mcp';
import { lineageAttributeNames } from '@beonauto/operations';
import { Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { DefinitionEvent } from '../registry/definition-events.ts';
import { declaredFactsOf, ownedStreamsOf } from '../run-work/declared-facts.ts';
import { coreRunFactTypes } from '../runs/run-events.ts';
import type { EventPublished } from './published-events.ts';

export const runSourcePrefix = '/runs/';

export const definitionSourcePrefix = '/definitions/';

export const callerSourcePrefix = '/callers/';

type WorkflowEventType =
  | 'workflow_input_applied'
  | 'step_started'
  | 'step_waiting'
  | 'step_finished'
  | 'step_failed'
  | 'step_skipped'
  | 'reaction_refused';

type FeedType = ToolTestEvent['type'] | DefinitionEvent['type'] | EventPublished['type'] | WorkflowEventType;

const feedTypes: Readonly<Record<FeedType, true>> = {
  tool_test_started: true,
  tool_test_answered: true,
  tool_test_failed: true,
  definition_created: true,
  definition_updated: true,
  definition_retired: true,
  event_published: true,
  workflow_input_applied: true,
  step_started: true,
  step_waiting: true,
  step_finished: true,
  step_failed: true,
  step_skipped: true,
  reaction_refused: true,
};

type NamingCapability = Pick<Capability, 'facts' | 'runWords'>;

function deferralTypesOf(capabilities: readonly NamingCapability[]): readonly string[] {
  return capabilities.map(({ runWords }) => runWords.deferralType).filter((type) => type !== 'run_deferred');
}

function streamTypesOf(capabilities: readonly NamingCapability[]): readonly string[] {
  const names = ownedStreamsOf(capabilities).map(({ publicNames }) => publicNames);
  return [...names.flatMap((named) => Object.keys(named)), ...names.flatMap((named) => Object.values(named).flat())];
}

function brainTypesOf(capabilities: readonly NamingCapability[]): ReadonlySet<string> {
  return new Set([
    ...coreRunFactTypes,
    ...declaredFactsOf(capabilities).map(({ type }) => type),
    ...streamTypesOf(capabilities),
    ...deferralTypesOf(capabilities),
    ...Object.keys(feedTypes),
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

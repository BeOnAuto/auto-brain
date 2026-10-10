import type { ConversationCallEvent, ToolTestEvent } from '@beonauto/mcp';
import { lineageAttributeNames } from '@beonauto/operations';
import { Schema } from 'effect';

import type { DefinitionEvent } from '../registry/definition-events.ts';
import type { RunEvent } from '../runs/run-events.ts';
import type { EventPublished } from './published-events.ts';

export const runSourcePrefix = '/runs/';

export const definitionSourcePrefix = '/definitions/';

export const callerSourcePrefix = '/callers/';

type CapabilityEventType = 'interaction_requested';

type WorkflowEventType =
  | 'workflow_input_applied'
  | 'step_started'
  | 'step_waiting'
  | 'step_finished'
  | 'step_failed'
  | 'step_skipped'
  | 'reaction_refused';

type FeedType =
  | RunEvent['type']
  | ToolTestEvent['type']
  | ConversationCallEvent['type']
  | DefinitionEvent['type']
  | EventPublished['type']
  | CapabilityEventType
  | WorkflowEventType;

const brainTypes: Readonly<Record<FeedType, true>> = {
  run_started: true,
  run_deferred: true,
  run_succeeded: true,
  run_rejected: true,
  run_failed: true,
  run_cancel_requested: true,
  tool_call_started: true,
  tool_call_answered: true,
  tool_call_failed: true,
  delivery_started: true,
  delivery_succeeded: true,
  delivery_failed: true,
  delivery_refused: true,
  reply_taken: true,
  reply_refused: true,
  tool_test_started: true,
  tool_test_answered: true,
  tool_test_failed: true,
  replies_read: true,
  reading_failed: true,
  telling_started: true,
  telling_succeeded: true,
  telling_failed: true,
  interaction_requested: true,
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

export const reservedEventTypes: ReadonlySet<string> = new Set(Object.keys(brainTypes));

const reservedSourcePrefixes: readonly string[] = [runSourcePrefix, definitionSourcePrefix, callerSourcePrefix];

const reservedTypesInWords = [...reservedEventTypes].join(', ');

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

function brainOwnAttributes(attributes: Attributes) {
  const { type, source } = attributes;
  return [
    ...lineageIssues(attributes),
    ...(reservedEventTypes.has(type)
      ? [
          {
            path: ['type'],
            issue: `Expected a type of your own, not one the brain records itself: ${reservedTypesInWords}`,
          },
        ]
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
}

export const refusingTheBrainsOwnAttributes = Schema.makeFilter(brainOwnAttributes);

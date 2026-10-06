import { Schema } from 'effect';

import type { ExecutionEvent } from '../execution/execution-events.ts';
import type { SpecEvent } from '../registry/spec-events.ts';
import type { EventPublished } from './published-events.ts';

export const runSourcePrefix = '/executions/';

export const specSourcePrefix = '/specs/';

type WorkflowInputApplied = 'workflow_input_applied';

type FeedType = ExecutionEvent['type'] | SpecEvent['type'] | EventPublished['type'] | WorkflowInputApplied;

const brainTypes: Readonly<Record<FeedType, true>> = {
  execution_started: true,
  execution_deferred: true,
  execution_succeeded: true,
  execution_rejected: true,
  execution_failed: true,
  tool_call_started: true,
  tool_call_answered: true,
  spec_created: true,
  spec_updated: true,
  spec_retired: true,
  event_published: true,
  workflow_input_applied: true,
};

export const reservedEventTypes: ReadonlySet<string> = new Set(Object.keys(brainTypes));

export const reservedSourcePrefixes: readonly string[] = [runSourcePrefix, specSourcePrefix];

const reservedTypesInWords = [...reservedEventTypes].join(', ');

const reservedSourcesInWords = reservedSourcePrefixes.join(' or ');

interface Attributes {
  readonly type: string;
  readonly source?: string;
}

export function isReservedSource(source: string): boolean {
  return reservedSourcePrefixes.some((prefix) => source.startsWith(prefix));
}

function brainOwnAttributes({ type, source }: Attributes) {
  return [
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

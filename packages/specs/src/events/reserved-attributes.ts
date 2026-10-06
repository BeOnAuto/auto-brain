import { Schema } from 'effect';

import type { ExecutionEvent } from '../execution/execution-events.ts';
import type { SpecEvent } from '../registry/spec-events.ts';

export const runSourcePrefix = '/executions/';

export const specSourcePrefix = '/specs/';

const recordedTypes: Readonly<Record<ExecutionEvent['type'] | SpecEvent['type'], true>> = {
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
};

export const reservedEventTypes: ReadonlySet<string> = new Set(Object.keys(recordedTypes));

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

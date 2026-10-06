import { Schema } from 'effect';

export const runSourcePrefix = '/executions/';

export const specSourcePrefix = '/specs/';

export const reservedEventTypes: ReadonlySet<string> = new Set([
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
  'spec_created',
  'spec_updated',
  'spec_retired',
]);

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

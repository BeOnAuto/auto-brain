import type { Decider } from '@beonauto/operations';
import { Result } from 'effect';

import { SpecEventSchema, type SpecEvent } from './spec-events.ts';

export interface RecordedVersion {
  readonly source: string;
  readonly position: number;
}

export interface VersionSearch {
  readonly position: number;
  readonly found: RecordedVersion | undefined;
}

function evolvedSearch(name: string, version: number): (search: VersionSearch, event: SpecEvent) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    const isTheVersion = event.type !== 'spec_retired' && event.name === name && event.version === version;
    return { position: at, found: isTheVersion ? { source: event.content.source, position: at } : found };
  };
}

export function specVersionDecider(name: string, version: number): Decider<VersionSearch, null, SpecEvent> {
  return {
    initialState: { position: 0, found: undefined },
    evolve: evolvedSearch(name, version),
    decide: () => Result.succeed([]),
    eventSchema: SpecEventSchema,
  };
}

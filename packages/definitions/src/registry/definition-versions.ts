import type { Decider } from '@beonauto/operations';
import { Result } from 'effect';

import type { StrippedForms } from '../capability/stripped-forms.ts';
import { DefinitionEventSchema, type DefinitionEvent } from './definition-events.ts';

export interface RecordedVersion {
  readonly source: string;
  readonly stripped?: StrippedForms;
  readonly position: number;
}

export interface VersionSearch {
  readonly position: number;
  readonly found: RecordedVersion | undefined;
}

function evolvedSearch(
  name: string,
  version: number,
): (search: VersionSearch, event: DefinitionEvent) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    const isTheVersion = event.type !== 'definition_retired' && event.name === name && event.version === version;
    return {
      position: at,
      found: isTheVersion
        ? {
            source: event.content.source,
            ...(event.content.stripped === undefined ? {} : { stripped: event.content.stripped }),
            position: at,
          }
        : found,
    };
  };
}

export function definitionVersionDecider(name: string, version: number): Decider<VersionSearch, null, DefinitionEvent> {
  return {
    initialState: { position: 0, found: undefined },
    evolve: evolvedSearch(name, version),
    decide: () => Result.succeed([]),
    eventSchema: DefinitionEventSchema,
  };
}

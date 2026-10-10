import type { Decider, Recorded } from '@beonauto/operations';
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
): (search: VersionSearch, event: Recorded<DefinitionEvent>) => VersionSearch {
  return ({ position, found }, event) => {
    const at = position + 1;
    const { definitionName, definitionVersion } = event.context;
    if (event.type === 'definition_retired' || definitionName !== name || definitionVersion !== version) {
      return { position: at, found };
    }
    const { source, stripped } = event.data.content;
    return { position: at, found: { source, ...(stripped === undefined ? {} : { stripped }), position: at } };
  };
}

export function definitionVersionDecider(name: string, version: number): Decider<VersionSearch, null, DefinitionEvent> {
  return {
    initialState: { position: 0, found: undefined },
    evolve: evolvedSearch(name, version),
    decide: () => Result.succeed([]),
    context: () => ({ at: '', by: '' }),
    eventSchema: DefinitionEventSchema,
  };
}

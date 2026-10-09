import { Option, Schema } from 'effect';

import { DefinitionEventSchema } from './definition-events.ts';
import type { Trigger } from './definition-triggers.ts';

export type DefinitionChange =
  | {
      readonly kind: 'activated';
      readonly name: string;
      readonly version: number;
      readonly triggers: readonly Trigger[];
      readonly at: string;
    }
  | { readonly kind: 'deactivated'; readonly name: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unreadable' };

const decodeDefinitionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(DefinitionEventSchema));

const unreadable: DefinitionChange = { kind: 'unreadable' };

export function definitionChangeOf(data: unknown): DefinitionChange {
  return Option.match(decodeDefinitionEvent(data), {
    onNone: () => unreadable,
    onSome: (event): DefinitionChange => {
      if (event.type === 'definition_retired') {
        return { kind: 'deactivated', name: event.name };
      }
      const { name, version, content, at } = event;
      const { triggers = [] } = content;
      if (triggers.length > 0) {
        return { kind: 'activated', name, version, triggers, at };
      }
      return event.type === 'definition_updated' ? { kind: 'deactivated', name } : { kind: 'unchanged' };
    },
  });
}

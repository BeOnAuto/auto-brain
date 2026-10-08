import { Option, Schema } from 'effect';

import { SpecEventSchema } from './spec-events.ts';
import type { Trigger } from './spec-triggers.ts';

export type SpecChange =
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

const decodeSpecEvent = Schema.decodeUnknownOption(Schema.toCodecJson(SpecEventSchema));

const unreadable: SpecChange = { kind: 'unreadable' };

export function specChangeOf(data: unknown): SpecChange {
  return Option.match(decodeSpecEvent(data), {
    onNone: () => unreadable,
    onSome: (event): SpecChange => {
      if (event.type === 'spec_retired') {
        return { kind: 'deactivated', name: event.name };
      }
      const { name, version, content, at } = event;
      const { triggers = [] } = content;
      if (triggers.length > 0) {
        return { kind: 'activated', name, version, triggers, at };
      }
      return event.type === 'spec_updated' ? { kind: 'deactivated', name } : { kind: 'unchanged' };
    },
  });
}

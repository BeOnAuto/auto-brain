import { Option, Schema } from 'effect';

import { SpecEventSchema } from './spec-events.ts';

export type SpecChange =
  | {
      readonly kind: 'activated';
      readonly name: string;
      readonly version: number;
      readonly source: string;
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
      if (content.reacts === true) {
        return { kind: 'activated', name, version, source: content.source, at };
      }
      return event.type === 'spec_updated' ? { kind: 'deactivated', name } : { kind: 'unchanged' };
    },
  });
}

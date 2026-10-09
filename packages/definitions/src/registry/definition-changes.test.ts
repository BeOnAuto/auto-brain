import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionChangeOf } from './definition-changes.ts';
import { DefinitionEventSchema, type DefinitionContent, type DefinitionEvent } from './definition-events.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(DefinitionEventSchema));

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const triggers: DefinitionContent['triggers'] = [
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1-5' },
  { kind: 'every', reference: '/schedule/every', milliseconds: 900_000 },
];

const reacting: DefinitionContent = { source: 'schedule: ...', triggers };

const plain = { source: 'do: []' };

function changeOf(event: DefinitionEvent) {
  return definitionChangeOf(encode(event));
}

describe('the change a record of a definition makes to what starts on its own', () => {
  it('activates a version with triggers, and deactivates the definition at a version without or at its retirement', () => {
    expect([
      changeOf({ type: 'definition_created', name: 'close', version: 1, content: reacting, ...at }),
      changeOf({ type: 'definition_updated', name: 'close', version: 2, content: plain, ...at }),
      changeOf({ type: 'definition_retired', name: 'close', ...at }),
      changeOf({ type: 'definition_created', name: 'plain', version: 1, content: plain, ...at }),
      definitionChangeOf({ type: 'definition_created' }),
    ]).toEqual([
      { kind: 'activated', name: 'close', version: 1, triggers, at: at.at },
      { kind: 'deactivated', name: 'close' },
      { kind: 'deactivated', name: 'close' },
      { kind: 'unchanged' },
      { kind: 'unreadable' },
    ]);
  });
});

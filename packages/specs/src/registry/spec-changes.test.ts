import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { specChangeOf } from './spec-changes.ts';
import { SpecEventSchema, type SpecContent, type SpecEvent } from './spec-events.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(SpecEventSchema));

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const triggers: SpecContent['triggers'] = [
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1-5' },
  { kind: 'every', reference: '/schedule/every', milliseconds: 900_000 },
];

const reacting: SpecContent = { source: 'schedule: ...', triggers };

const plain = { source: 'do: []' };

function changeOf(event: SpecEvent) {
  return specChangeOf(encode(event));
}

describe('the change a record of a spec makes to what starts on its own', () => {
  it('activates a version with triggers, and deactivates the spec at a version without or at its retirement', () => {
    expect([
      changeOf({ type: 'spec_created', name: 'close', version: 1, content: reacting, ...at }),
      changeOf({ type: 'spec_updated', name: 'close', version: 2, content: plain, ...at }),
      changeOf({ type: 'spec_retired', name: 'close', ...at }),
      changeOf({ type: 'spec_created', name: 'plain', version: 1, content: plain, ...at }),
      specChangeOf({ type: 'spec_created' }),
    ]).toEqual([
      { kind: 'activated', name: 'close', version: 1, triggers, at: at.at },
      { kind: 'deactivated', name: 'close' },
      { kind: 'deactivated', name: 'close' },
      { kind: 'unchanged' },
      { kind: 'unreadable' },
    ]);
  });
});

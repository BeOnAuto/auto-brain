import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { specChangeOf } from './spec-changes.ts';
import { SpecEventSchema, type SpecContent, type SpecEvent } from './spec-events.ts';

const encode = Schema.encodeSync(Schema.toCodecJson(SpecEventSchema));

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const reacting: SpecContent = { source: 'schedule: ...', reacts: true };

const plain = { source: 'do: []' };

function changeOf(event: SpecEvent) {
  return specChangeOf(encode(event));
}

describe('the change a record of a spec makes to what reacts', () => {
  it('activates a version that reacts, and deactivates the spec at a version that does not or at its retirement', () => {
    expect([
      changeOf({ type: 'spec_created', name: 'close', version: 1, content: reacting, ...at }),
      changeOf({ type: 'spec_updated', name: 'close', version: 2, content: plain, ...at }),
      changeOf({ type: 'spec_retired', name: 'close', ...at }),
      changeOf({ type: 'spec_created', name: 'plain', version: 1, content: plain, ...at }),
      specChangeOf({ type: 'spec_created' }),
    ]).toEqual([
      { kind: 'activated', name: 'close', version: 1, source: 'schedule: ...', at: at.at },
      { kind: 'deactivated', name: 'close' },
      { kind: 'deactivated', name: 'close' },
      { kind: 'unchanged' },
      { kind: 'unreadable' },
    ]);
  });
});

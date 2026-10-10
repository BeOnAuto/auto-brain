import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { checkedContext, contextOf, holdsNoForbiddenCharacter, type Context } from './context.ts';
import { factOf, recordedWith } from './decider.ts';

const ofACall: Context = {
  at: '2026-10-09T12:43:51.435Z',
  by: 'brain:finance',
  runId: 'ccd1dbdd',
  definitionType: 'interaction',
  definitionName: 'approve-report',
  definitionVersion: 1,
  calledBy: { runId: 'run-0', reference: '/do/0/ask', run: 1 },
  callDepth: 1,
  depth: 2,
  trigger: { kind: 'event', reference: '/schedule/on' },
};

describe('the context of a recorded message', () => {
  it('is read from its metadata without the store’s own fields', () => {
    expect(
      contextOf({
        ...ofACall,
        messageId: '419f8fb7',
        streamName: 'brain/acme/finance/runs/ccd1dbdd',
        streamPosition: '1',
        correlationId: 'run-0',
        causationId: null,
        traceId: '2e22',
      }),
    ).toEqual(ofACall);
  });

  it('refuses text with a control character, an unpaired surrogate or a noncharacter, and a long reference', () => {
    const refused = [
      { ...ofACall, by: 'brain:\u0000finance' },
      { ...ofACall, definitionName: 'approve\uD800' },
      { ...ofACall, runId: 'run￾' },
      { ...ofACall, calledBy: { runId: 'run-0', reference: `/${'a'.repeat(256)}`, run: 1 } },
      { ...ofACall, trigger: { kind: 'event', reference: `/${'é'.repeat(128)}` } },
      { at: ofACall.at },
    ];

    expect(refused.map((context: unknown) => Result.isFailure(Result.try(() => contextOf(context))))).toEqual(
      refused.map(() => true),
    );
    expect(() => checkedContext({ ...ofACall, depth: 0 })).toThrow('Expected a value greater than or equal to 1');
    expect(checkedContext(ofACall)).toEqual(ofACall);
    expect([holdsNoForbiddenCharacter('café ✓'), holdsNoForbiddenCharacter('\u007F')]).toEqual([true, false]);
  });
});

describe('a fact as a decider records it', () => {
  const NotedSchema = factOf('noted', Schema.Struct({ note: Schema.String }));

  it('names its type once beside its data, and is handed back with its context', () => {
    const noted = Schema.decodeUnknownSync(NotedSchema)({ type: 'noted', data: { note: 'kept' } });

    expect(recordedWith<typeof noted>(ofACall)(noted)).toEqual({
      type: 'noted',
      data: { note: 'kept' },
      context: ofACall,
    });
    expect(() => Schema.decodeUnknownSync(NotedSchema)({ type: 'noted', note: 'kept' })).toThrow('Missing key');
  });
});

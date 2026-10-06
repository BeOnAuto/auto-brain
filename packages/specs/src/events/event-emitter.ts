import { Conflict, streamPrefixOfBrain, type BrainAddress, type Ledger, type Lineage } from '@beonauto/operations';
import { Effect, Option, Result, Schema, SchemaIssue } from 'effect';

import { jsonBytesOf } from '../execution/recorded-size.ts';
import { CloudEventSchema, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { publishedEventDecider, publishedEventStreamOf, type Emitter } from './published-events.ts';
import { refusingTheBrainsOwnAttributes } from './reserved-attributes.ts';

export interface Emission {
  readonly event: Schema.Json;
  readonly emitter: Emitter;
  readonly depth: number;
  readonly by: string;
  readonly at: string;
}

export type EmitOutcome = 'recorded' | 'already_recorded' | 'refused';

export type EmitEvent = (
  brain: BrainAddress,
  emission: Emission,
  lineage: Lineage,
) => Effect.Effect<EmitOutcome, Conflict>;

const EmittedEventSchema = CloudEventSchema.check(refusingTheBrainsOwnAttributes);

const decodeEvent = Schema.decodeUnknownOption(EmittedEventSchema);

const decodeEmitted = Schema.decodeUnknownResult(EmittedEventSchema);

const formatIssues = SchemaIssue.makeFormatterDefault();

export function emittedEventOf(event: Schema.Json): CloudEvent | undefined {
  return Option.getOrUndefined(
    Option.filter(decodeEvent(event), (decoded) => jsonBytesOf(decoded) <= mostPublishedEventBytes),
  );
}

export function emittedEventRefusal(event: Schema.Json): string | undefined {
  return Option.getOrUndefined(
    Option.map(Result.getFailure(decodeEmitted(event)), ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue)
        .replaceAll(/\n\s+at \["?([^"\]]*)"?\]/gu, ' (at $1)')
        .replaceAll('\n', '; '),
    ),
  );
}

function refusedUnlessChanging({ detail, kind }: Readonly<Pick<Conflict, 'detail' | 'kind'>>) {
  return kind === 'concurrent_change'
    ? Effect.fail(new Conflict({ detail, kind }))
    : Effect.succeed<EmitOutcome>('refused');
}

export function eventEmitter(ledger: Ledger['Service']): EmitEvent {
  return (brain, { event, emitter, depth, by, at }, lineage) => {
    const cloudEvent = emittedEventOf(event);
    if (cloudEvent === undefined) {
      return Effect.succeed('refused');
    }
    const stream = `${streamPrefixOfBrain(brain)}${publishedEventStreamOf(cloudEvent.source, cloudEvent.id)}`;
    const publication = { event: cloudEvent, filled: [], emitted_by: emitter, depth, by, at };
    return ledger.execute(stream, publishedEventDecider, publication, lineage).pipe(
      Effect.map(({ state }): EmitOutcome => (state?.at === at ? 'recorded' : 'already_recorded')),
      Effect.catchTag('conflict', refusedUnlessChanging),
    );
  };
}

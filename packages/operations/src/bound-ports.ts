import { Effect } from 'effect';

import type { BrainAddress } from './brain-scope.ts';
import type { OrgAddress } from './org-scope.ts';
import type { StreamReader, StreamWriter } from './stream-ports.ts';

const streamNameGrammar = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})*$/u;

const longestStreamName = 256;

function wellFormed(stream: string): Effect.Effect<string> {
  return stream.length <= longestStreamName && streamNameGrammar.test(stream)
    ? Effect.succeed(stream)
    : Effect.die(new Error(`The stream name ${JSON.stringify(stream)} is malformed`));
}

export function streamPrefixOfOrg({ org }: OrgAddress): string {
  return `org/${org}/`;
}

export function streamPrefixOfBrain({ org, brain }: BrainAddress): string {
  return `brain/${org}/${brain}/`;
}

export function readerWithin(ledger: StreamReader, prefix: string): StreamReader {
  return {
    load: (stream, decider) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.load(`${prefix}${relative}`, decider))),
  };
}

export function writerWithin(ledger: StreamWriter, prefix: string): StreamWriter {
  return {
    execute: (stream, decider, command) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.execute(`${prefix}${relative}`, decider, command))),
  };
}

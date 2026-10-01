import type { BrainAddress } from './brain-scope.ts';
import type { OrgAddress } from './org-scope.ts';
import type { StreamReader, StreamWriter } from './stream-ports.ts';

export function streamPrefixOfOrg({ org }: OrgAddress): string {
  return `org/${org}/`;
}

export function streamPrefixOfBrain({ org, brain }: BrainAddress): string {
  return `brain/${org}/${brain}/`;
}

export function readerWithin(ledger: StreamReader, prefix: string): StreamReader {
  return { load: (stream, decider) => ledger.load(`${prefix}${stream}`, decider) };
}

export function writerWithin(ledger: StreamWriter, prefix: string): StreamWriter {
  return { execute: (stream, decider, command) => ledger.execute(`${prefix}${stream}`, decider, command) };
}

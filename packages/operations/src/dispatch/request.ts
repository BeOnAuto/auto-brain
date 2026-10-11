import type { CallLink, TriggerLink } from '../caller/call-lineage.ts';
import type { CallerIdentity } from '../caller/caller.ts';
import type { StreamedContent } from '../content/streamed-content.ts';
import type { InputEncoding } from '../definition/registered-run.ts';
import type { Lineage } from '../ledger/message-lineage.ts';

export interface OrgRequest {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly input: unknown;
  readonly encoding: InputEncoding;
  readonly body?: StreamedContent;
}

export interface BrainRequest extends OrgRequest {
  readonly brain: string;
  readonly lineage?: Lineage;
  readonly depth?: number;
  readonly callDepth?: number;
  readonly calledBy?: CallLink;
  readonly trigger?: TriggerLink;
}

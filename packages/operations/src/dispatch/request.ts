import type { CallerIdentity } from '../caller/caller.ts';
import type { InputEncoding } from '../definition/registration.ts';

export interface OrgRequest {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly input: unknown;
  readonly encoding: InputEncoding;
}

export interface BrainRequest extends OrgRequest {
  readonly brain: string;
}

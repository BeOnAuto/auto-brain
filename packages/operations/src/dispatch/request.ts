import type { CallerIdentity } from '../caller/caller.ts';
import type { InputForm } from '../definition/registration.ts';

export interface OrgRequest {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly input: unknown;
  readonly form: InputForm;
}

export interface BrainRequest extends OrgRequest {
  readonly brain: string;
}

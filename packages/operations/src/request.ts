import type { CallerIdentity } from './caller.ts';
import type { InputForm } from './registration.ts';

export interface OrgRequest {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly input: unknown;
  readonly form: InputForm;
}

export interface BrainRequest extends OrgRequest {
  readonly brain: string;
}

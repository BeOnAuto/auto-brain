import { BrainIdSchema, CallerIdentitySchema, type CallerIdentity } from '@beonauto/operations';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { Schema } from 'effect';

export interface OrgCall {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly requestId: string;
}

export interface BrainCall extends OrgCall {
  readonly brain: string;
}

export interface HandedOff {
  readonly authInfo?: { readonly extra?: Readonly<Record<string, unknown>> | undefined } | undefined;
}

const placeholderToken = 'verified-by-auto-brain';

const OrgCallSchema = Schema.Struct({ caller: CallerIdentitySchema, org: Schema.String, requestId: Schema.String });

const BrainCallSchema = Schema.Struct({ ...OrgCallSchema.fields, brain: BrainIdSchema });

const decodeOrgCall = Schema.decodeUnknownSync(OrgCallSchema);

const decodeBrainCall = Schema.decodeUnknownSync(BrainCallSchema);

export function authInfoFor(call: OrgCall | BrainCall): AuthInfo {
  return {
    token: placeholderToken,
    clientId: call.caller.id,
    scopes: [...call.caller.permissions],
    extra: { ...call },
  };
}

export function orgCallOf({ authInfo }: HandedOff): OrgCall {
  return decodeOrgCall(authInfo?.extra);
}

export function brainCallOf({ authInfo }: HandedOff): BrainCall {
  return decodeBrainCall(authInfo?.extra);
}

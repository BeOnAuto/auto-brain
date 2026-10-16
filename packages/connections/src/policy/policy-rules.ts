import { Forbidden, listed } from '@on.auto/operations';

import type { ConnectionEntry, ConnectionKind } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
import type { ConnectionPolicy } from './connection-policy.ts';

export interface Addition {
  readonly kind: ConnectionKind;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
}

function allowing(items: readonly string[], none: string): string {
  return items.length === 0 ? none : listed(items);
}

function matches(pattern: string, host: string): boolean {
  const lowered = pattern.toLowerCase();
  return lowered.startsWith('*.') ? host.endsWith(lowered.slice(1)) : host === lowered;
}

function hostsOf({ kind, entry, credential }: Addition): readonly string[] {
  const addresses = [...(kind === 'mcp' ? [entry.url] : [entry.document, entry.base_url]), credential.issuer];
  return addresses.filter((address) => address !== undefined).map((address) => new URL(address).hostname);
}

function hostRefusal(allowedHosts: readonly string[] | null, addition: Addition): Forbidden | undefined {
  if (allowedHosts === null) {
    return undefined;
  }
  const refused = hostsOf(addition).find((host) => !allowedHosts.some((pattern) => matches(pattern, host)));
  return refused === undefined
    ? undefined
    : new Forbidden({
        detail: `A connection may not reach the host ${refused} on this runtime, which allows ${allowing(allowedHosts, 'no host')}`,
      });
}

const variablesRule = 'A reference may name only a variable the operator lists in connections.variables';

function referenceRefusal(variables: readonly string[], { credential }: Addition): Forbidden | undefined {
  const { kind, name = '' } = credential;
  if (kind !== 'reference' || variables.includes(name)) {
    return undefined;
  }
  return new Forbidden({
    detail:
      variables.length === 0
        ? `${variablesRule}, and this runtime lists none`
        : `${variablesRule}, which are ${listed(variables)}, and ${name} is not one of them`,
  });
}

function kindRefusal(credentialKinds: ConnectionPolicy['credentialKinds'], { credential }: Addition) {
  return credentialKinds === null || credentialKinds.includes(credential.kind)
    ? undefined
    : new Forbidden({
        detail: `A connection may not take a ${credential.kind} credential on this runtime, which allows ${allowing(credentialKinds, 'no kind of credential')}`,
      });
}

export function policyRefusalOf(policy: ConnectionPolicy, addition: Addition): Forbidden | undefined {
  if (!policy.peopleMayAdd) {
    return new Forbidden({
      detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
    });
  }
  return (
    hostRefusal(policy.allowedHosts, addition) ??
    kindRefusal(policy.credentialKinds, addition) ??
    referenceRefusal(policy.variables, addition)
  );
}

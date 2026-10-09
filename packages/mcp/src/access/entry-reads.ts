import type { BrainAddress } from '@beonauto/operations';
import { Function, Result } from 'effect';

import { secretsOfServers } from '../bounds/secrets.ts';
import { startedFields, type StartedFields } from '../calls/recorded-calls.ts';
import type { DeliveryCall } from '../delivery/delivery-bounds.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { McpServerSettings } from '../settings/mcp-settings.ts';
import { namedLinks } from './tool-naming.ts';
import type { ToolNotOffered } from './tool-not-offered.ts';

export type NamingCheck = (
  address: BrainAddress,
  references: readonly ToolReference[],
) => Result.Result<void, ToolNotOffered>;

export type StartOf = (call: Pick<DeliveryCall, 'reference' | 'input'>) => StartedFields;

export function namingOf(servers: readonly McpServerSettings[]): NamingCheck {
  const entries = new Map(servers.map((settings) => [settings.name, { settings }]));
  return (address, references) => Result.map(namedLinks(address, { references, links: entries }), Function.constVoid);
}

export function startsOf(servers: readonly McpServerSettings[]): StartOf {
  const { scrub } = secretsOfServers(servers);
  return ({ reference, input }) => {
    const entry = servers.find(({ name }) => name === reference.server);
    const recording = { content: entry?.record_content === true, requestId: false, scrub };
    return startedFields({ ...reference, argumentsJson: JSON.stringify(input) }, recording);
  };
}

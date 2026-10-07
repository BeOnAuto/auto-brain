import { servesBrain } from '@beonauto/config';
import { Effect } from 'effect';

import { isAllowed } from '../access/tool-naming.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { writtenOf } from '../names/tool-reference.ts';
import { calledOnce } from './call-once.ts';
import { failedWith, type DeliveryAccess, type DeliveryCall, type DeliveryCallEnded } from './delivery-bounds.ts';

function linkOf(call: DeliveryCall, access: DeliveryAccess): ServerLink | DeliveryCallEnded {
  const link = access.links.get(call.reference.server);
  if (link === undefined || !servesBrain(link.settings, call)) {
    return failedWith('not_offered', `No MCP server named ${call.reference.server} is configured for this brain`);
  }
  return isAllowed(call.reference, access.allowed)
    ? link
    : failedWith('not_offered', `The operator of this server does not allow ${writtenOf(call.reference)}`);
}

export function deliveredCall(call: DeliveryCall, access: DeliveryAccess): Effect.Effect<DeliveryCallEnded> {
  const link = linkOf(call, access);
  return 'outcome' in link ? Effect.succeed(link) : Effect.promise((signal) => calledOnce(call, link, access, signal));
}

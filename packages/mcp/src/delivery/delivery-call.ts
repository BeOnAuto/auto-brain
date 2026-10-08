import { Array as Arr, Effect, Option, Result } from 'effect';

import { namedLinks } from '../access/tool-naming.ts';
import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import { calledOnce } from './call-once.ts';
import { failedWith, type DeliveryAccess, type DeliveryCall, type DeliveryCallEnded } from './delivery-bounds.ts';

export function deliveredCall(call: DeliveryCall, access: DeliveryAccess): Effect.Effect<DeliveryCallEnded> {
  const named = namedLinks(call, { references: [call.reference], links: access.links, allowed: access.allowed });
  return Result.match(named, {
    onFailure: ({ detail }: Pick<ToolNotOffered, 'detail'>) => Effect.succeed(failedWith('not_offered', detail)),
    onSuccess: (links) => {
      const link = Option.getOrThrow(Arr.head(links));
      return Effect.promise((signal) => calledOnce(call, link, access, signal));
    },
  });
}

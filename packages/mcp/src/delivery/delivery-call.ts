import { Array as Arr, Effect, Option, Result } from 'effect';

import { namedLinks } from '../access/tool-naming.ts';
import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { Recording } from '../calls/recorded-calls.ts';
import type { ServerLink } from '../connections/server-links.ts';
import { answeredOnce, calledOnce } from './call-once.ts';
import type { CalledOnce, DeliveryAccess, DeliveryCall } from './delivery-bounds.ts';

function recordingOn({ settings }: ServerLink, { secrets }: DeliveryAccess): Recording {
  return { content: settings.record_content, requestId: settings.request_id !== null, scrub: secrets.scrub };
}

function called(call: DeliveryCall, link: ServerLink, access: DeliveryAccess): Effect.Effect<CalledOnce> {
  return Effect.gen(function* () {
    const began = performance.now();
    const done = yield* Effect.promise((signal) => calledOnce(call, link, access, signal));
    return 'kind' in done ? done : answeredOnce(done, Math.round(performance.now() - began), recordingOn(link, access));
  });
}

export function deliveredCall(call: DeliveryCall, access: DeliveryAccess): Effect.Effect<CalledOnce> {
  return Result.match(namedLinks(call, { references: [call.reference], links: access.links }), {
    onFailure: ({ because, detail }: Pick<ToolNotOffered, 'because' | 'detail'>) =>
      Effect.succeed({ kind: 'not_offered', because, detail }),
    onSuccess: (links) => called(call, Option.getOrThrow(Arr.head(links)), access),
  });
}

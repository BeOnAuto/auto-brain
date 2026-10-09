import { Array as Arr, Effect, Option, Result } from 'effect';

import type { Listing } from '../access/server-listing.ts';
import { namedLinks } from '../access/tool-naming.ts';
import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { CallJournal, Recording } from '../calls/recorded-calls.ts';
import { journalledCall, type CallJournalling } from '../calls/tool-caller.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { openedFor } from './call-opening.ts';
import { answeredOnce, notOfferedOnce, type CalledOnce } from './called-once.ts';

export interface OneCall {
  readonly org: string;
  readonly brain: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly longestRetryWaitMs?: number;
}

export interface RunCall {
  readonly callId: string;
  readonly journal: CallJournal;
}

export type CallOnce = (call: OneCall, runCall?: RunCall) => Effect.Effect<CalledOnce>;

export interface OneCallAccess extends Listing {
  readonly links: ReadonlyMap<string, ServerLink>;
}

interface Calling {
  readonly access: OneCallAccess;
  readonly journalling: CallJournalling | undefined;
  readonly signal: Readonly<AbortSignal>;
}

const notRecorded = 'The start of the call could not be recorded on its run, so the call was not sent';

function recordingOn({ settings }: ServerLink, { secrets }: OneCallAccess): Recording {
  return { content: settings.record_content, requestId: settings.request_id !== null, scrub: secrets.scrub };
}

async function calledOnce(call: OneCall, link: ServerLink, { access, journalling, signal }: Calling) {
  const opened = await openedFor(call.reference, link, access);
  if ('kind' in opened) {
    return opened;
  }
  const { slot, tool } = opened;
  const recording = recordingOn(link, access);
  const { callMs } = access.timing;
  const longestRetryWaitMs = Math.min(call.longestRetryWaitMs ?? 0, access.timing.longestRetryWaitMs);
  const forwarding = { slot, tool: tool.name, input: call.input, meta: call.meta, callMs, longestRetryWaitMs, signal };
  try {
    const journey = await journalledCall(forwarding, recording, journalling);
    if (!journey.sent) {
      throw new Error(notRecorded);
    }
    return answeredOnce(journey.done, { durationMs: journey.durationMs, recording, annotations: tool.annotations });
  } finally {
    await slot.release();
  }
}

type Run = <A>(effect: Effect.Effect<A>) => Promise<A>;

function journallingOf(runCall: RunCall | undefined, run: Run): CallJournalling | undefined {
  return runCall === undefined
    ? undefined
    : {
        callId: runCall.callId,
        started: (fact) => run(runCall.journal.started(fact)),
        answered: async (fact) => {
          await run(runCall.journal.answered(fact));
        },
      };
}

function called(call: OneCall, link: ServerLink, access: OneCallAccess, runCall?: RunCall): Effect.Effect<CalledOnce> {
  return Effect.gen(function* () {
    const journalling = journallingOf(runCall, Effect.runPromiseWith(yield* Effect.context()));
    return yield* Effect.promise((signal) => calledOnce(call, link, { access, journalling, signal }));
  });
}

export function oneCall(call: OneCall, access: OneCallAccess, runCall?: RunCall): Effect.Effect<CalledOnce> {
  return Result.match(namedLinks(call, { references: [call.reference], links: access.links }), {
    onFailure: (refusal: Pick<ToolNotOffered, 'because' | 'detail'>) => Effect.succeed(notOfferedOnce(refusal)),
    onSuccess: (links) => called(call, Option.getOrThrow(Arr.head(links)), access, runCall),
  });
}

import { Effect } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { runTools, type RunTools } from '../calls/run-tools.ts';
import type { RunContext, ServerMessage, ToolsNotOpened } from './run-context.ts';
import { listedOn, released } from './server-listing.ts';
import { namedLinks, notOffered, offeredOn, unlistedOn, type Naming } from './tool-naming.ts';

export interface Opening extends Naming {
  readonly execution: RunContext;
  readonly secrets: Secrets;
  readonly timing: Timing;
  readonly report: (message: ServerMessage) => void;
}

export function openedRun(opening: Opening): Effect.Effect<RunTools, ToolsNotOpened> {
  return Effect.gen(function* () {
    const links = yield* Effect.fromResult(namedLinks(opening));
    const context = yield* Effect.context();
    const listed = yield* Effect.fromResult(yield* Effect.promise(() => listedOn(links, opening)));
    const missing = listed.flatMap((each) => unlistedOn(each, opening));
    if (missing.length > 0) {
      yield* Effect.promise(() => released(listed));
      return yield* notOffered('tool_not_listed', missing, 'which its MCP server does not list');
    }
    return runTools({
      ...opening,
      slots: listed.map(({ slot }) => slot),
      offered: listed.flatMap((each) => offeredOn(each, opening)),
      run: Effect.runPromiseWith(context),
    });
  });
}

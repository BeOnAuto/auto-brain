import { Effect, Result } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { runTools, type RunTools } from '../calls/run-tools.ts';
import { ignored } from '../connections/ignored.ts';
import type { CallerContext, ServerMessage, ToolsNotOpened } from './caller-context.ts';
import type { McpServerFailed } from './mcp-server-failed.ts';
import { listedOn, released, type Listing as ToolsListing } from './server-listing.ts';
import { namedLinks, notListed, offeredOn, unlistedOn, type Listed, type Naming } from './tool-naming.ts';

export interface Opening extends Naming, Pick<ToolsListing, 'toolsListed'> {
  readonly context: CallerContext;
  readonly secrets: Secrets;
  readonly timing: Timing;
  readonly report: (message: ServerMessage) => void;
}

type Listing = Promise<Result.Result<readonly Listed[], McpServerFailed>>;

function releasedOnceSettled(listing: Listing): Effect.Effect<void> {
  return Effect.sync(() => {
    void listing
      .then(Result.getOrElse((): readonly Listed[] => []))
      .then(released)
      .catch(ignored);
  });
}

export function openedRun(opening: Opening): Effect.Effect<RunTools, ToolsNotOpened> {
  return Effect.gen(function* () {
    const links = yield* Effect.fromResult(namedLinks(opening.context, opening));
    const context = yield* Effect.context();
    const listing = yield* Effect.sync(() => listedOn(links, opening));
    const settled = yield* Effect.promise(() => listing).pipe(Effect.onInterrupt(() => releasedOnceSettled(listing)));
    const listed = yield* Effect.fromResult(settled);
    const missing = listed.flatMap((each) => unlistedOn(each, opening));
    if (missing.length > 0) {
      yield* Effect.promise(() => released(listed));
      return yield* notListed(missing);
    }
    return runTools({
      ...opening,
      slots: listed.map(({ slot }) => slot),
      offered: listed.flatMap((each) => offeredOn(each, opening)),
      run: Effect.runPromiseWith(context),
    });
  });
}

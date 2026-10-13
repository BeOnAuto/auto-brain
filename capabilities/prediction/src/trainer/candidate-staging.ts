import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { buildEnded } from './waiting-builds.ts';

export function staged(
  ports: Pick<PredictionPorts, 'ledger'>,
  { address }: Pick<BuildState, 'address'>,
  path: string,
  sha256: string,
): Effect.Effect<void, Conflict> {
  const { org, playbook, id } = address;
  const stream = Readable.toWeb(createReadStream(path));
  return ports.ledger.content
    .stage({ org, playbook }, id, { stream, mediaType: 'application/octet-stream', expected: { sha256 } })
    .pipe(
      Effect.asVoid,
      Effect.catchTags({ staging_ended: () => Effect.fail(buildEnded), content_refused: Effect.die }),
    );
}

export function stagedUnlessItIs(
  ports: Pick<PredictionPorts, 'ledger'>,
  build: Pick<BuildState, 'address'>,
  path: string,
  sha256: string,
): Effect.Effect<void, Conflict> {
  const { org, playbook, id } = build.address;
  return Effect.flatMap(ports.ledger.content.staged({ org, playbook }, id, sha256), (found) =>
    found === undefined ? staged(ports, build, path, sha256) : Effect.promise(() => found.stream.cancel()),
  );
}

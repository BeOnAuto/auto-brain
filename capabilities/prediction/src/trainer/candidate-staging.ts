import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { Effect } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';

export function staged(ports: PredictionPorts, build: BuildState, path: string, sha256: string): Effect.Effect<void> {
  const { org, playbook, id } = build.address;
  const stream = Readable.toWeb(createReadStream(path));
  return Effect.asVoid(
    Effect.orDie(
      ports.ledger.content.stage({ org, playbook }, id, {
        stream,
        mediaType: 'application/octet-stream',
        expected: { sha256 },
      }),
    ),
  );
}

import { Conflict, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { buildRowFrom, predictionBuildsName } from '../builds/build-rows.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';

const day = 86_400_000;

export interface Asked {
  readonly playbook: PlaybookAddress;
  readonly name: string;
  readonly now: number;
  readonly inbox: boolean;
}

function inFlight({ ledger }: PredictionPorts, { playbook, name }: Asked): Effect.Effect<Conflict | undefined> {
  return Effect.map(
    ledger.readProjectedRows(predictionBuildsName, playbook, {
      where: [
        { column: 'function', equals: name },
        { column: 'open', equals: true },
      ],
      orderBy: ['requested_at'],
      order: 'desc',
      limit: 1,
    }),
    ([open]) =>
      open === undefined
        ? undefined
        : new Conflict({
            detail: `A build of this function is in flight, run ${open.key}; wait for it or cancel it`,
            kind: 'build_in_flight',
          }),
  );
}

function fullForTheDay({ ledger, bounds }: PredictionPorts, { playbook, name, now }: Asked) {
  return Effect.map(
    ledger.readProjectedRows(predictionBuildsName, playbook, {
      where: [{ column: 'function', equals: name }],
      orderBy: ['requested_at'],
      order: 'desc',
      limit: bounds.buildsPerDay,
    }),
    (rows) => {
      const today = rows.map(({ row }) => buildRowFrom(row).requested_at).filter((at) => at > now - day);
      return today.length < bounds.buildsPerDay
        ? undefined
        : new Unavailable({
            detail: `This function has had its ${bounds.buildsPerDay} builds of the day; ask again after ${new Date(Number(today.at(-1)) + day).toISOString()}`,
            kind: 'builds_full',
          });
    },
  );
}

function fullForTheDeployment({ ledger, bounds }: PredictionPorts): Effect.Effect<Unavailable | undefined> {
  return Effect.map(
    ledger.readDueRows(predictionBuildsName, {
      column: 'in_flight',
      through: Number.MAX_SAFE_INTEGER,
      limit: bounds.buildsAtOnce,
    }),
    (rows) =>
      rows.length < bounds.buildsAtOnce
        ? undefined
        : new Unavailable({
            detail: 'Every build permit of this server is taken; ask again shortly',
            kind: 'builds_full',
          }),
  );
}

function fullOfRequests(ports: PredictionPorts, { playbook, inbox }: Asked): Effect.Effect<Unavailable | undefined> {
  if (!inbox) {
    return Effect.undefined;
  }
  return Effect.map(ports.openRequests(playbook), (open) =>
    open < ports.bounds.mostOpenRequests
      ? undefined
      : new Unavailable({
          detail: `The playbook holds ${open} open requests, the most it may; one must be answered, expire or be cancelled before a build asks its trainer`,
          kind: 'requests_full',
        }),
  );
}

export function buildRefusal(ports: PredictionPorts, asked: Asked): Effect.Effect<Conflict | Unavailable | undefined> {
  return Effect.gen(function* () {
    return (
      (yield* inFlight(ports, asked)) ??
      (yield* fullForTheDay(ports, asked)) ??
      (yield* fullForTheDeployment(ports)) ??
      (yield* fullOfRequests(ports, asked))
    );
  });
}

import { Effect } from 'effect';

import type { ConnectionServer, ConnectionSource, ConnectionUnready, OrgConnection } from './connection-source.ts';
import { isUnready, unreadyServer, type Linked, type OrgServer, type Served } from './org-servers.ts';

export type LinkConnection = (id: string, server: ConnectionServer) => Promise<Linked>;

type Prepared = { readonly server: ConnectionServer } | { readonly unready: ConnectionUnready };

type Run = <A>(effect: Effect.Effect<A>) => Promise<A>;

type ConnectedState = Extract<OrgConnection['state'], { readonly status: 'connected' }>;

interface HeldInAnOrg {
  readonly servers: Map<string, Promise<Prepared>>;
  readonly links: Map<string, Promise<Linked>>;
}

export interface ConnectionLinks {
  readonly serversOf: (org: string) => Effect.Effect<readonly OrgServer[]>;
  readonly close: () => Promise<void>;
}

async function stopped(link: Promise<Linked>): Promise<void> {
  const linked = await link;
  if ('link' in linked) {
    await linked.link.stop();
  }
}

function linkOnce(prepared: Prepared, id: string, link: LinkConnection): Promise<Linked> {
  return 'unready' in prepared ? Promise.resolve({ refused: prepared.unready }) : link(id, prepared.server);
}

function isFailedToDescribe(linked: Linked): boolean {
  return 'refused' in linked && !isUnready(linked.refused.because);
}

function preparedIn(held: HeldInAnOrg, id: string, state: ConnectedState, run: Run): Promise<Prepared> {
  const prepared =
    held.servers.get(id) ??
    run(
      Effect.match(state.server, {
        onSuccess: (server): Prepared => ({ server }),
        onFailure: (unready): Prepared => ({ unready }),
      }),
    );
  held.servers.set(id, prepared);
  return prepared;
}

function linkedIn(held: HeldInAnOrg, id: string, prepared: Promise<Prepared>, link: LinkConnection): Promise<Linked> {
  const linking =
    held.links.get(id) ??
    prepared
      .then((ready) => linkOnce(ready, id, link))
      .then((linked) => {
        if (isFailedToDescribe(linked)) {
          held.links.delete(id);
        }
        return linked;
      });
  held.links.set(id, linking);
  return linking;
}

function prunedTo(held: HeldInAnOrg, connections: readonly OrgConnection[]): Promise<readonly void[]> {
  const connected = new Set(connections.filter(({ state }) => state.status === 'connected').map(({ id }) => id));
  const gone = [...held.servers.keys()].filter((id) => !connected.has(id));
  const stopping = gone.flatMap((id) => {
    const link = held.links.get(id);
    held.servers.delete(id);
    held.links.delete(id);
    return link === undefined ? [] : [stopped(link)];
  });
  return Promise.all(stopping);
}

function unreadinessOf(prepared: Prepared): readonly ConnectionUnready[] {
  return 'unready' in prepared ? [prepared.unready] : [];
}

export function connectionLinks(source: ConnectionSource, link: LinkConnection): ConnectionLinks {
  const heldByOrg = new Map<string, HeldInAnOrg>();
  const heldIn = (org: string): HeldInAnOrg => {
    const held = heldByOrg.get(org) ?? { servers: new Map(), links: new Map() };
    heldByOrg.set(org, held);
    return held;
  };
  const serverOf = (org: string, { id, serving, state }: OrgConnection, run: Run): OrgServer => {
    const settings: Served = { ...serving, connection: id };
    if (state.status === 'unready') {
      return unreadyServer(settings, state.unready);
    }
    const prepared = (): Promise<Prepared> => preparedIn(heldIn(org), id, state, run);
    return {
      settings,
      checked: async () => unreadinessOf(await prepared()),
      linked: () => linkedIn(heldIn(org), id, prepared(), link),
    };
  };
  return {
    serversOf: (org) =>
      Effect.gen(function* () {
        const connections = yield* source.connectionsOf(org);
        yield* Effect.promise(() => prunedTo(heldIn(org), connections));
        const run = Effect.runPromiseWith(yield* Effect.context());
        return connections.map((connection) => serverOf(org, connection, run));
      }),
    close: async () => {
      const links = [...heldByOrg.values()].flatMap((held) => Array.from(held.links.values()));
      heldByOrg.clear();
      await Promise.all(links.map((each) => stopped(each)));
    },
  };
}

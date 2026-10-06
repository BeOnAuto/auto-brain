import type { Presenter } from './presenter.ts';
import type { PublicEvent } from './public-event.ts';
import type { RecordedEvent } from './recorded-read.ts';

export interface Presentation {
  readonly present: (recorded: RecordedEvent) => readonly PublicEvent[];
  readonly publicTypes: readonly string[];
  readonly storedTypesOf: (publicType: string) => readonly string[];
}

export function streamKindOf(stream: string): string {
  const end = stream.indexOf('/');
  return end === -1 ? stream : stream.slice(0, end);
}

interface PublicName {
  readonly stored: string;
  readonly name: string;
}

function requireOnePresenterPerKind(presenters: readonly Presenter[]): void {
  const kinds = presenters.map(({ streamKind }) => streamKind);
  const repeated = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
  if (repeated !== undefined) {
    throw new Error(`More than one presenter presents the stream kind ${repeated}`);
  }
}

interface Presenting {
  readonly presenter: Presenter;
  readonly presented: ReadonlySet<string>;
}

function presentingOf(presenter: Presenter): Presenting {
  const presented = Object.entries(presenter.publicNames)
    .filter(([, names]: readonly [string, readonly string[]]) => names.length > 0)
    .map(([stored]: readonly [string, readonly string[]]) => stored);
  return { presenter, presented: new Set(presented) };
}

export function presentationOf(presenters: readonly Presenter[]): Presentation {
  requireOnePresenterPerKind(presenters);
  const byKind = new Map(presenters.map((presenter) => [presenter.streamKind, presentingOf(presenter)]));
  const named = presenters
    .flatMap(({ publicNames }) => Object.entries(publicNames))
    .flatMap(([stored, names]: readonly [string, readonly string[]]): readonly PublicName[] =>
      names.map((name) => ({ stored, name })),
    );
  return {
    present: (recorded) => {
      const presenting = byKind.get(streamKindOf(recorded.stream));
      return presenting !== undefined && presenting.presented.has(recorded.type)
        ? presenting.presenter.present(recorded)
        : [];
    },
    publicTypes: [...new Set(named.map(({ name }) => name))],
    storedTypesOf: (publicType) => [
      ...new Set(named.filter(({ name }) => name === publicType).map(({ stored }) => stored)),
    ],
  };
}

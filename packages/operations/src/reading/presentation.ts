import type { Presenter } from './presenter.ts';
import type { PublicEvent } from './public-event.ts';
import type { RecordedEvent } from './recorded-read.ts';

export interface Presentation {
  readonly present: (recorded: RecordedEvent) => PublicEvent | null;
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

function presents({ publicNames }: Presenter, { type }: RecordedEvent): boolean {
  return Object.hasOwn(publicNames, type) && typeof publicNames[type] === 'string';
}

export function presentationOf(presenters: readonly Presenter[]): Presentation {
  requireOnePresenterPerKind(presenters);
  const byKind = new Map(presenters.map((presenter) => [presenter.streamKind, presenter]));
  const named = presenters
    .flatMap(({ publicNames }) => Object.entries(publicNames))
    .flatMap(([stored, name]: readonly [string, string | null]): readonly PublicName[] =>
      name === null ? [] : [{ stored, name }],
    );
  return {
    present: (recorded) => {
      const presenter = byKind.get(streamKindOf(recorded.stream));
      return presenter !== undefined && presents(presenter, recorded) ? presenter.present(recorded) : null;
    },
    publicTypes: [...new Set(named.map(({ name }) => name))],
    storedTypesOf: (publicType) => [
      ...new Set(named.filter(({ name }) => name === publicType).map(({ stored }) => stored)),
    ],
  };
}

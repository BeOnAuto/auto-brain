import { randomUUID } from 'node:crypto';

import type { AppendSignal, EncodedEvent, EventStore } from '@beonauto/ledger';
import type { Schema } from 'effect';

import type { ViewDetails } from '../views/view-details.ts';
import { alpha, playbookKeyOf, type Playbook } from './view-documents.ts';

interface RunOf {
  readonly at?: string;
  readonly playbook?: Playbook;
}

type Append = (stream: string, events: readonly EncodedEvent[]) => Promise<void>;

type Ran = (subject: string, output: Schema.Json, more?: RunOf) => Promise<string>;

export interface PlaybookAppends {
  readonly append: Append;
  readonly saved: (name: string, details: ViewDetails, playbook?: Playbook) => Promise<void>;
  readonly retired: (name: string) => Promise<void>;
  readonly ran: Ran;
  readonly ranEach: (subject: string, outputs: readonly Schema.Json[]) => Promise<unknown>;
  readonly ranInOneStream: (subject: string, outputs: readonly Schema.Json[]) => Promise<void>;
  readonly published: (event: Schema.JsonObject, playbook?: Playbook) => Promise<void>;
}

const savedAt = '2026-10-06T09:00:00.000Z';

const ranAt = '2026-10-06T10:00:00.000Z';

function appendOn(store: EventStore, appends: AppendSignal): Append {
  const streams = new Map<string, number>();
  return async (stream, events) => {
    const version = streams.get(stream) ?? 0;
    await store.append(stream, events, version);
    streams.set(stream, version + events.length);
    appends.raise(stream);
  };
}

function ranBy(append: Append): Ran {
  return async (subject, output, { at = ranAt, playbook = alpha } = {}) => {
    const [type = '', name = ''] = subject.split('/');
    const id = randomUUID();
    const definition = { definition_type: type, name, definition_version: 1, by: 'acme-admin', at };
    await append(`${playbookKeyOf(playbook)}runs/${id}`, [
      { type: 'run_started', data: { type: 'run_started', ...definition, input: {} } },
      { type: 'run_succeeded', data: { type: 'run_succeeded', ...definition, output, record: {} } },
    ]);
    return id;
  };
}

function savedBy(append: Append): PlaybookAppends['saved'] {
  const definitions = new Map<string, number>();
  return async (name, details, playbook = alpha) => {
    const key = `${playbookKeyOf(playbook)}${name}`;
    const version = (definitions.get(key) ?? 0) + 1;
    definitions.set(key, version);
    const type = version === 1 ? 'definition_created' : 'definition_updated';
    const content = { source: `the ${name} document, version ${version}`, details };
    await append(`${playbookKeyOf(playbook)}definitions/recall`, [
      { type, data: { type, name, version, content, by: 'acme-admin', at: savedAt } },
    ]);
  };
}

export function playbookAppends(store: EventStore, appends: AppendSignal): PlaybookAppends {
  const append = appendOn(store, appends);
  const ran = ranBy(append);
  return {
    append,
    saved: savedBy(append),
    retired: async (name) => {
      const event = { type: 'definition_retired', name, by: 'acme-admin', at: savedAt };
      await append(`${playbookKeyOf(alpha)}definitions/recall`, [{ type: 'definition_retired', data: event }]);
    },
    ran,
    ranInOneStream: async (subject, outputs) => {
      const [type = '', name = ''] = subject.split('/');
      const definition = { definition_type: type, name, definition_version: 1, by: 'acme-admin', at: ranAt };
      await append(
        `${playbookKeyOf(alpha)}runs/${randomUUID()}`,
        outputs.map((output) => ({
          type: 'run_succeeded',
          data: { type: 'run_succeeded', ...definition, output, record: {} },
        })),
      );
    },
    ranEach: (subject, outputs) =>
      outputs.reduce<Promise<unknown>>((before, output) => before.then(() => ran(subject, output)), Promise.resolve()),
    published: async (event, playbook = alpha) => {
      const published = { type: 'event_published', event, filled: [], by: 'acme-admin', at: ranAt };
      await append(`${playbookKeyOf(playbook)}events/${randomUUID()}`, [{ type: 'event_published', data: published }]);
    },
  };
}

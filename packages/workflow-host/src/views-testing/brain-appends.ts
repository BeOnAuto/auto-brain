import { randomUUID } from 'node:crypto';

import type { AppendSignal, EncodedEvent, EventStore } from '@beonauto/ledger';
import type { Schema } from 'effect';

import type { ViewDetails } from '../views/view-details.ts';
import { alpha, brainKeyOf, type Brain } from './view-documents.ts';

interface RunOf {
  readonly at?: string;
  readonly brain?: Brain;
}

type Append = (stream: string, events: readonly EncodedEvent[]) => Promise<void>;

type Ran = (subject: string, output: Schema.Json, more?: RunOf) => Promise<string>;

export interface BrainAppends {
  readonly append: Append;
  readonly saved: (name: string, details: ViewDetails, brain?: Brain) => Promise<void>;
  readonly retired: (name: string) => Promise<void>;
  readonly ran: Ran;
  readonly ranEach: (subject: string, outputs: readonly Schema.Json[]) => Promise<unknown>;
  readonly ranInOneStream: (subject: string, outputs: readonly Schema.Json[]) => Promise<void>;
  readonly published: (event: Schema.JsonObject, brain?: Brain) => Promise<void>;
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
  return async (subject, output, { at = ranAt, brain = alpha } = {}) => {
    const [primitive = '', name = ''] = subject.split('/');
    const id = randomUUID();
    const definition = { primitive, name, spec_version: 1, by: 'acme-admin', at };
    await append(`${brainKeyOf(brain)}executions/${id}`, [
      { type: 'execution_started', data: { type: 'execution_started', ...definition, input: {} } },
      { type: 'execution_succeeded', data: { type: 'execution_succeeded', ...definition, output, record: {} } },
    ]);
    return id;
  };
}

function savedBy(append: Append): BrainAppends['saved'] {
  const specs = new Map<string, number>();
  return async (name, details, brain = alpha) => {
    const key = `${brainKeyOf(brain)}${name}`;
    const version = (specs.get(key) ?? 0) + 1;
    specs.set(key, version);
    const type = version === 1 ? 'spec_created' : 'spec_updated';
    const content = { source: `the ${name} document, version ${version}`, details };
    await append(`${brainKeyOf(brain)}specs/recollection`, [
      { type, data: { type, name, version, content, by: 'acme-admin', at: savedAt } },
    ]);
  };
}

export function brainAppends(store: EventStore, appends: AppendSignal): BrainAppends {
  const append = appendOn(store, appends);
  const ran = ranBy(append);
  return {
    append,
    saved: savedBy(append),
    retired: async (name) => {
      const event = { type: 'spec_retired', name, by: 'acme-admin', at: savedAt };
      await append(`${brainKeyOf(alpha)}specs/recollection`, [{ type: 'spec_retired', data: event }]);
    },
    ran,
    ranInOneStream: async (subject, outputs) => {
      const [primitive = '', name = ''] = subject.split('/');
      const definition = { primitive, name, spec_version: 1, by: 'acme-admin', at: ranAt };
      await append(
        `${brainKeyOf(alpha)}executions/${randomUUID()}`,
        outputs.map((output) => ({
          type: 'execution_succeeded',
          data: { type: 'execution_succeeded', ...definition, output, record: {} },
        })),
      );
    },
    ranEach: (subject, outputs) =>
      outputs.reduce<Promise<unknown>>((before, output) => before.then(() => ran(subject, output)), Promise.resolve()),
    published: async (event, brain = alpha) => {
      const published = { type: 'event_published', event, filled: [], by: 'acme-admin', at: ranAt };
      await append(`${brainKeyOf(brain)}events/${randomUUID()}`, [{ type: 'event_published', data: published }]);
    },
  };
}

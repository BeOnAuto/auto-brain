import { isJson, isObject, jsonBytesOf, type JsonObject } from '@beonauto/workflow-engine/dsl/json';

import { raised, type RaisedError } from './raised-error.ts';
import { retainedBytesOf } from './retained-size.ts';

export type EventFilter = (event: JsonObject) => boolean;

export interface Inbox {
  readonly deliver: (event: unknown) => void;
  readonly eventsDelivered: () => number;
  readonly takeEvent: (accepts: EventFilter) => JsonObject | undefined;
  readonly overflow: () => RaisedError | undefined;
}

export const mostWaitingEvents = 64;

export const mostWaitingEventBytes = 1_048_576;

export const mostReceivedEvents = 1024;

export const mostReceivedEventBytes = 4_194_304;

interface Waiting {
  readonly event: JsonObject;
  readonly bytes: number;
}

export function makeInbox(): Inbox {
  const inbox: Waiting[] = [];
  const delivered = new Set<string>();
  let waitingBytes = 0;
  let received = 0;
  let receivedBytes = 0;
  let overflow: RaisedError | undefined;
  const overflowing = (title: string): void => {
    overflow = raised('runtime', 500, title, '/');
    inbox.length = 0;
    waitingBytes = 0;
  };
  return {
    deliver: (event) => {
      if (overflow !== undefined || !isJson(event)) {
        return;
      }
      received += 1;
      receivedBytes += jsonBytesOf(event);
      if (received > mostReceivedEvents || receivedBytes > mostReceivedEventBytes) {
        overflowing(
          `The workflow was sent more than ${mostReceivedEvents} events or ${mostReceivedEventBytes} bytes of events, the most a workflow takes over its life`,
        );
        return;
      }
      if (!isEvent(event) || delivered.has(event['id'])) {
        return;
      }
      const bytes = retainedBytesOf(event);
      if (inbox.length >= mostWaitingEvents || waitingBytes + bytes > mostWaitingEventBytes) {
        overflowing(
          `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds`,
        );
        return;
      }
      delivered.add(event['id']);
      inbox.push({ event, bytes });
      waitingBytes += bytes;
    },
    eventsDelivered: () => delivered.size,
    takeEvent: (accepts) => {
      const position = inbox.findIndex(({ event }) => accepts(event));
      const [taken] = position === -1 ? [] : inbox.splice(position, 1);
      waitingBytes -= taken?.bytes ?? 0;
      return taken?.event;
    },
    overflow: () => overflow,
  };
}

function isEvent(value: unknown): value is JsonObject & { readonly id: string; readonly type: string } {
  return isJson(value) && isObject(value) && typeof value['id'] === 'string' && typeof value['type'] === 'string';
}

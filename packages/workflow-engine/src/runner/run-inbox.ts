import { jsonBytesOf, type JsonObject } from '../dsl/json.ts';
import { raised } from '../dsl/raised-error.ts';
import type { ReceivedEvent } from '../inbox/received-event.ts';
import type { DslError } from '../machine/dsl-error.ts';
import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '../machine/limits.ts';
import type { InboxState } from '../machine/run-state.ts';

export interface Inbox {
  readonly takeEvent: (accepts: (event: JsonObject) => boolean) => JsonObject | undefined;
  readonly receiveEvent: (event: ReceivedEvent) => DslError | undefined;
  readonly clear: () => void;
  readonly inbox: () => InboxState;
}

function overflowError(
  received: number,
  receivedBytes: number,
  waiting: number,
  waitingBytes: number,
): DslError | undefined {
  if (received > mostReceivedEvents || receivedBytes > mostReceivedEventBytes) {
    return raised(
      'runtime',
      500,
      `The workflow was sent more than ${mostReceivedEvents} events or ${mostReceivedEventBytes} bytes of events, the most a workflow takes over its life`,
      '/',
    ).error;
  }
  return waiting > mostWaitingEvents || waitingBytes > mostWaitingEventBytes
    ? raised(
        'runtime',
        500,
        `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds`,
        '/',
      ).error
    : undefined;
}

export function inboxOf(start: InboxState): Inbox {
  const current = { ...start, waiting: [...start.waiting], receivedIds: [...start.receivedIds] };
  return {
    takeEvent: (accepts) => {
      const position = current.waiting.findIndex(({ event }) => accepts(event));
      const [taken] = position === -1 ? [] : current.waiting.splice(position, 1);
      current.waitingBytes -= taken?.bytes ?? 0;
      return taken?.event;
    },
    receiveEvent: (event) => {
      const bytes = jsonBytesOf(event);
      const overflow = overflowError(
        current.received + 1,
        current.receivedBytes + bytes,
        current.waiting.length + 1,
        current.waitingBytes + bytes,
      );
      if (overflow === undefined) {
        current.received += 1;
        current.receivedBytes += bytes;
        current.receivedIds.push(event.id);
        current.waiting.push({ event, bytes });
        current.waitingBytes += bytes;
      }
      return overflow;
    },
    clear: () => {
      current.waiting = [];
      current.waitingBytes = 0;
    },
    inbox: () => current,
  };
}

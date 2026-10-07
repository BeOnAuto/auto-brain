import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';

export interface StoredMessage {
  readonly stream: string;
  readonly type: string;
  readonly data: unknown;
}

export interface InlineProjection {
  readonly types: readonly string[];
  readonly handle: (messages: readonly StoredMessage[], execute: StatementExecutor) => Promise<void>;
}

interface AppendTransaction {
  readonly execute: StatementExecutor;
}

export interface InlineRegistration {
  readonly type: 'inline';
  readonly projection: {
    readonly canHandle: string[];
    readonly handle: (messages: readonly unknown[], transaction: AppendTransaction) => Promise<void>;
  };
}

const AppendedMessageSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Unknown,
  metadata: Schema.Struct({ streamName: Schema.String }),
});

const decodeAppendedMessage = Schema.decodeUnknownSync(AppendedMessageSchema);

function storedMessageOf(message: unknown): StoredMessage {
  const { type, data, metadata } = decodeAppendedMessage(message);
  return { stream: metadata.streamName, type, data };
}

export function inlineRegistrationOf({ types, handle }: InlineProjection): InlineRegistration {
  return {
    type: 'inline',
    projection: {
      canHandle: [...types],
      handle: (messages, { execute }) =>
        handle(
          messages.map((message) => storedMessageOf(message)),
          execute,
        ),
    },
  };
}

export function inTurn<Item>(items: readonly Item[], each: (item: Item) => Promise<unknown>): Promise<void> {
  return items.reduce<Promise<void>>(async (done, item) => {
    await done;
    await each(item);
  }, Promise.resolve());
}

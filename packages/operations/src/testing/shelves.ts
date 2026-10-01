import { Effect, Result, Schema } from 'effect';

import { BrainReader, BrainWriter, defineCommand, defineQuery, type Decider } from '../index.ts';

const ItemSchema = Schema.Struct({ item: Schema.String });

type Item = typeof ItemSchema.Type;

const ItemShelvedSchema = Schema.Struct({ type: Schema.Literal('item_shelved'), item: Schema.String });

type ItemShelved = typeof ItemShelvedSchema.Type;

const shelf: Decider<readonly string[], Item, ItemShelved> = {
  initialState: [],
  evolve: (items, { item }) => [...items, item],
  decide: ({ item }) => Result.succeed([{ type: 'item_shelved', item }]),
  eventSchema: ItemShelvedSchema,
};

const Shelved = Schema.Struct({ items: Schema.Array(Schema.String) });

export const putOnShelf = defineCommand('brain', {
  name: 'put_on_shelf',
  title: 'Put on shelf',
  description: 'Puts an item on the shelf the caller names.',
  route: { method: 'POST', path: '/shelves/{shelf}' },
  inputSchema: Schema.Struct({ shelf: Schema.String, item: Schema.String }),
  outputSchema: Shelved,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* ({ shelf: named, item }) {
    const { state } = yield* (yield* BrainWriter).execute(`shelves/${named}`, shelf, { item });
    return { items: state };
  }),
});

export const readShelf = defineQuery('brain', {
  name: 'read_shelf',
  title: 'Read shelf',
  description: 'Lists the items on the shelf the caller names.',
  route: { method: 'GET', path: '/shelves/{shelf}' },
  inputSchema: Schema.Struct({ shelf: Schema.String }),
  outputSchema: Shelved,
  reasons: [],
  handle: Effect.fnUntraced(function* ({ shelf: named }) {
    const { state } = yield* (yield* BrainReader).load(`shelves/${named}`, shelf);
    return { items: state };
  }),
});

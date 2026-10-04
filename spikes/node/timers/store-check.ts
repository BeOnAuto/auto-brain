import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openTimerStore } from './timer-store.ts';

const directory = join(import.meta.dirname, '..', '.data', 'store-check');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const fileName = join(directory, 'timers.db');
const store = openTimerStore(fileName);
const other = new DatabaseSync(fileName);
const seen = (database: DatabaseSync) =>
  database.prepare('SELECT id, cancelled, fired_at FROM timers ORDER BY id').all();
store.arm({ id: 't-1', runId: 'r', fireAt: 1000, summary: 'x' });
store.arm({ id: 't-2', runId: 'r', fireAt: 2000, summary: 'x' });
console.log('after arming, other connection sees', seen(other));
console.log('earliest', store.earliest(), 'in transaction:', store.database.isTransaction);
console.log('cancel t-2', store.cancel('t-2'), 'in transaction:', store.database.isTransaction);
console.log('own connection sees', seen(store.database));
console.log('other connection sees', seen(other));
console.log(
  'due',
  store.due(5000).map(({ id }) => id),
  'in transaction:',
  store.database.isTransaction,
);
console.log('other connection sees', seen(other));
other.close();
store.close();
const reopened = new DatabaseSync(fileName);
console.log('after closing both, a new connection sees', seen(reopened));
reopened.close();

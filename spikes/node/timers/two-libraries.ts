import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Effect, Result, Schema } from 'effect';

import { openLedger } from '../../../packages/ledger/src/testing/open-ledger.ts';
import type { Decider } from '../../../packages/operations/src/index.ts';

const TickSchema = Schema.Struct({ type: Schema.Literal('ticked') });

const ticks: Decider<number, null, typeof TickSchema.Type> = {
  initialState: 0,
  evolve: (count) => count + 1,
  decide: () => Result.succeed([{ type: 'ticked' }]),
  eventSchema: TickSchema,
};

async function trial(sameFile: boolean, rounds: number, lanes: number): Promise<object> {
  const directory = join(import.meta.dirname, '..', '.data', `two-libraries-${sameFile ? 'same' : 'separate'}`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const ledgerFile = join(directory, 'ledger.db');
  const timersFile = sameFile ? ledgerFile : join(directory, 'timers.db');
  const { ledger, dispose } = await openLedger(ledgerFile);
  const database = new DatabaseSync(timersFile, { timeout: 5_000 });
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
  database.exec('INSERT OR IGNORE INTO counter (id, n) VALUES (1, 0)');
  const increment = database.prepare('UPDATE counter SET n = n + 1 WHERE id = 1');
  const read = database.prepare('SELECT n FROM counter WHERE id = 1');
  let errors = 0;
  let firstError = '';
  let increments = 0;
  const writer = async (lane: number): Promise<void> => {
    for (let round = 0; round < rounds / lanes; round += 1) {
      try {
        increment.run();
        increments += 1;
        await Effect.runPromise(ledger.execute(`owf-run:ticks-${lane}`, ticks, null));
      } catch (error) {
        errors += 1;
        firstError ||= String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, lane) => writer(lane)));
  const counted = Number(read.get()?.['n']);
  database.close();
  let version = 0;
  for (let lane = 0; lane < lanes; lane += 1) {
    version += (await Effect.runPromise(ledger.load(`owf-run:ticks-${lane}`, ticks))).version;
  }
  await dispose();
  const fresh = new DatabaseSync(timersFile);
  const persisted = Number(fresh.prepare('SELECT n FROM counter WHERE id = 1').get()?.['n']);
  const integrity = String(fresh.prepare('PRAGMA integrity_check').get()?.['integrity_check']);
  fresh.close();
  return {
    layout: sameFile ? 'node:sqlite and the ledger (sqlite3 package) on the same file' : 'separate files',
    rounds,
    lanes,
    increments,
    counterSeenByItsConnection: counted,
    counterAfterReopen: persisted,
    ledgerEvents: version,
    errors,
    firstError,
    integrity,
  };
}

const rounds = Number(process.argv[2] ?? '2000');
const lanes = Number(process.argv[3] ?? '8');
const report = [await trial(true, rounds, lanes), await trial(false, rounds, lanes)];
console.log(JSON.stringify(report, null, 2));
writeFileSync(join(import.meta.dirname, '..', 'results', 'two-libraries.json'), `${JSON.stringify(report, null, 2)}\n`);

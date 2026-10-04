import { DatabaseSync } from 'node:sqlite';

export interface Timer {
  readonly id: string;
  readonly runId: string;
  readonly fireAt: number;
  readonly summary: string;
}

export interface TimerStoreOptions {
  readonly busyTimeoutMs?: number;
  readonly lockingMode?: 'NORMAL' | 'EXCLUSIVE';
}

export interface TimerStore {
  readonly arm: (timer: Timer) => boolean;
  readonly cancel: (id: string) => boolean;
  readonly earliest: () => number | undefined;
  readonly due: (now: number) => readonly Timer[];
  readonly claim: (id: string, at: number, by: string) => boolean;
  readonly markFired: (id: string, at: number, by: string) => void;
  readonly recordEffect: (id: string, at: number, by: string, lateMs: number) => void;
  readonly database: DatabaseSync;
  readonly close: () => void;
}

const schema = `
  CREATE TABLE IF NOT EXISTS timers (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    fire_at INTEGER NOT NULL,
    summary TEXT NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0,
    fired_at REAL,
    fired_by TEXT
  );
  CREATE INDEX IF NOT EXISTS timers_due ON timers (fire_at) WHERE cancelled = 0 AND fired_at IS NULL;
  CREATE TABLE IF NOT EXISTS timer_effects (
    timer_id TEXT NOT NULL,
    fired_at REAL NOT NULL,
    fired_by TEXT NOT NULL,
    late_ms REAL NOT NULL
  );
`;

function timerOf(row: Record<string, unknown>): Timer {
  return {
    id: String(row['id']),
    runId: String(row['run_id']),
    fireAt: Number(row['fire_at']),
    summary: String(row['summary']),
  };
}

const tracing = process.env['SPIKE_TRACE_TIMERS'] === '1';

function trace(line: string): void {
  if (tracing) {
    console.error(`[timers ${new Date().toISOString()}] ${line}`);
  }
}

export function openTimerStore(fileName: string, options: TimerStoreOptions = {}): TimerStore {
  const database = new DatabaseSync(fileName, { timeout: options.busyTimeoutMs ?? 5_000 });
  database.exec(`PRAGMA locking_mode = ${options.lockingMode ?? 'NORMAL'}`);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec(schema);
  const arm = database.prepare('INSERT OR IGNORE INTO timers (id, run_id, fire_at, summary) VALUES (?, ?, ?, ?)');
  const cancel = database.prepare(
    'UPDATE timers SET cancelled = 1 WHERE id = ? AND fired_at IS NULL AND cancelled = 0',
  );
  const earliest = database.prepare('SELECT MIN(fire_at) AS at FROM timers WHERE cancelled = 0 AND fired_at IS NULL');
  const due = database.prepare(
    'SELECT id, run_id, fire_at, summary FROM timers WHERE cancelled = 0 AND fired_at IS NULL AND fire_at <= ? ORDER BY fire_at, id',
  );
  const claim = database.prepare(
    'UPDATE timers SET fired_at = ?, fired_by = ? WHERE id = ? AND fired_at IS NULL AND cancelled = 0',
  );
  const markFired = database.prepare('UPDATE timers SET fired_at = ?, fired_by = ? WHERE id = ?');
  const effect = database.prepare(
    'INSERT INTO timer_effects (timer_id, fired_at, fired_by, late_ms) VALUES (?, ?, ?, ?)',
  );
  return {
    arm: ({ id, runId, fireAt, summary }) => {
      const armed = Number(arm.run(id, runId, fireAt, summary).changes) === 1;
      trace(`arm ${id} at ${fireAt}: ${String(armed)}`);
      return armed;
    },
    cancel: (id) => {
      const cancelled = Number(cancel.run(id).changes) === 1;
      trace(
        `cancel ${id}: ${String(cancelled)}; row now ${JSON.stringify(database.prepare('SELECT cancelled, fired_at FROM timers WHERE id = ?').get(id))}; in transaction ${String(database.isTransaction)}`,
      );
      return cancelled;
    },
    earliest: () => {
      const at = earliest.get()?.['at'];
      return typeof at === 'number' ? at : undefined;
    },
    due: (now) => {
      const found = due.all(now).map(timerOf);
      trace(
        `due at ${now}: ${JSON.stringify(found.map(({ id }) => id))}; all rows ${JSON.stringify(database.prepare('SELECT id, cancelled, fired_at FROM timers').all())}`,
      );
      return found;
    },
    claim: (id, at, by) => Number(claim.run(at, by, id).changes) === 1,
    markFired: (id, at, by) => {
      markFired.run(at, by, id);
    },
    recordEffect: (id, at, by, lateMs) => {
      effect.run(id, at, by, lateMs);
    },
    database,
    close: () => {
      database.close();
    },
  };
}

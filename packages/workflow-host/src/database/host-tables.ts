import { viewsTable } from '../views/view-statements.ts';
import { statement, type Statement } from './statement.ts';

export interface AddedColumn {
  readonly table: string;
  readonly column: string;
  readonly added: Statement;
  readonly addedWhenMissing: Statement;
}

export function columnsOnSQLite(table: string): Statement {
  return statement`SELECT name FROM pragma_table_info(${table})`;
}

export const addedColumns: readonly AddedColumn[] = [
  {
    table: 'workflow_timers',
    column: 'armed_by',
    added: statement`ALTER TABLE workflow_timers ADD COLUMN armed_by BIGINT`,
    addedWhenMissing: statement`ALTER TABLE workflow_timers ADD COLUMN IF NOT EXISTS armed_by BIGINT`,
  },
  {
    table: 'workflow_calls',
    column: 'child',
    added: statement`ALTER TABLE workflow_calls ADD COLUMN child TEXT`,
    addedWhenMissing: statement`ALTER TABLE workflow_calls ADD COLUMN IF NOT EXISTS child TEXT`,
  },
  {
    table: 'workflow_calls',
    column: 'root_id',
    added: statement`ALTER TABLE workflow_calls ADD COLUMN root_id TEXT`,
    addedWhenMissing: statement`ALTER TABLE workflow_calls ADD COLUMN IF NOT EXISTS root_id TEXT`,
  },
];

export const indexesOfAddedColumns: readonly Statement[] = [
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_open_by_root ON workflow_calls (root_id)
    WHERE state IN ('running', 'waiting')`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_waiting_by_run ON workflow_calls (run_id) WHERE state = 'waiting'`,
];

const followerTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_brains (
    brain_key TEXT NOT NULL PRIMARY KEY,
    cursor TEXT,
    delivered TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    checked BIGINT NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_followed_brains_by_check ON workflow_followed_brains (waiting, checked)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_orgs (
    stream_id TEXT NOT NULL PRIMARY KEY,
    position BIGINT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_scans (name TEXT NOT NULL PRIMARY KEY)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_passed_runs (
    run_id TEXT NOT NULL PRIMARY KEY,
    passed_through BIGINT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_listeners (
    run_id TEXT NOT NULL,
    listener TEXT NOT NULL,
    brain_key TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    armed_by BIGINT NOT NULL,
    filters TEXT NOT NULL,
    workflow TEXT NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, listener)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_listeners_by_stream ON workflow_listeners (stream_id, passed)`,
  statement`CREATE INDEX IF NOT EXISTS workflow_listeners_by_brain ON workflow_listeners (brain_key)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_listener_types (
    brain_key TEXT NOT NULL,
    type TEXT NOT NULL,
    run_id TEXT NOT NULL,
    listener TEXT NOT NULL,
    PRIMARY KEY (brain_key, type, run_id, listener)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_subscriptions (
    brain_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    version BIGINT NOT NULL,
    kind TEXT NOT NULL,
    rule TEXT NOT NULL,
    activated_at BIGINT NOT NULL,
    next_due BIGINT,
    running TEXT,
    PRIMARY KEY (brain_key, workflow)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_subscriptions_due ON workflow_subscriptions (next_due)
    WHERE next_due IS NOT NULL`,
  statement`CREATE TABLE IF NOT EXISTS workflow_subscription_types (
    brain_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (brain_key, workflow, type)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_rates (
    brain_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    minute BIGINT NOT NULL,
    starts INTEGER NOT NULL,
    PRIMARY KEY (brain_key, workflow)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_backlog (
    brain_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    start TEXT NOT NULL,
    due BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (brain_key, execution_id)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_reaction_backlog_due ON workflow_reaction_backlog (due)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_reaction_refusals (
    brain_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    minute BIGINT NOT NULL,
    count INTEGER NOT NULL,
    reason TEXT NOT NULL,
    recorded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (brain_key, workflow)
  )`,
];

export const hostTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id TEXT NOT NULL PRIMARY KEY,
    stream_id TEXT NOT NULL,
    dispatched_through BIGINT NOT NULL DEFAULT 0,
    ended_at BIGINT,
    taken BIGINT NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_runs_live ON workflow_runs (taken, run_id)
    WHERE ended_at IS NULL OR dispatched_through < ended_at`,
  statement`CREATE TABLE IF NOT EXISTS workflow_snapshot_chunks (
    run_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    chunk INTEGER NOT NULL,
    chunks INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (run_id, version, chunk)
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_timers (
    run_id TEXT NOT NULL,
    timer_id TEXT NOT NULL,
    state TEXT NOT NULL,
    due_at BIGINT,
    armed_by BIGINT,
    PRIMARY KEY (run_id, timer_id)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_timers_due ON workflow_timers (due_at) WHERE state = 'armed'`,
  statement`CREATE TABLE IF NOT EXISTS workflow_calls (
    call_key TEXT NOT NULL PRIMARY KEY,
    run_id TEXT NOT NULL,
    state TEXT NOT NULL,
    call TEXT,
    attributes TEXT,
    result TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    child TEXT,
    root_id TEXT
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_unfinished ON workflow_calls (call_key)
    WHERE state = 'running' OR (state = 'answered' AND delivered = 0)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_pending_cancels (
    run_id TEXT NOT NULL PRIMARY KEY,
    cause TEXT NOT NULL,
    cancelled_by TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_due (
    run_id TEXT NOT NULL PRIMARY KEY,
    version BIGINT NOT NULL,
    next_due_at BIGINT
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_due_by_time ON workflow_due (next_due_at)
    WHERE next_due_at IS NOT NULL`,
  statement`CREATE TABLE IF NOT EXISTS workflow_settlements (
    run_id TEXT NOT NULL PRIMARY KEY,
    settlement TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at BIGINT
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_leases (
    name TEXT NOT NULL PRIMARY KEY,
    holder TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  ...followerTables,
  viewsTable,
];

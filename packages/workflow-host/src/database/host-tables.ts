import { statement, type Statement } from './statement.ts';

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
    delivered INTEGER NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_calls_unfinished ON workflow_calls (call_key)
    WHERE state = 'running' OR (state = 'answered' AND delivered = 0)`,
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
];

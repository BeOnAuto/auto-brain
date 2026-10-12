import { describe, expect, it } from 'vitest';

import {
  advancedColumnsOf,
  playbookStreamOf,
  requireAdvancedColumns,
  rowKeyOf,
  setsAdvancedColumns,
} from './keyed-projection.ts';
import { runTallyRows } from './tally-rows.ts';
import { topicRows } from './topic-rows.ts';

describe('the stream of a playbook a fact was appended to', () => {
  it('is read as the playbook key, the kind and the id, and nothing that names no kind and id', () => {
    expect([
      playbookStreamOf('playbook/acme/alpha/runs/r1'),
      playbookStreamOf('playbook/acme/alpha/runs'),
      playbookStreamOf('playbook/acme/alpha/runs/r1/nested'),
    ]).toEqual([{ playbookKey: 'playbook/acme/alpha/', kind: 'runs', id: 'r1' }, undefined, undefined]);
  });
});

describe('the key of the row a fact changes', () => {
  const opened = {
    id: 'message-1',
    position: 1,
    type: 'topic_opened',
    data: { topic: 'spring', at: 0 },
    context: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
  };

  it('is the stream’s id by default, what the mapping says otherwise, and none for a kind it does not fold', () => {
    const run = { playbookKey: 'playbook/acme/alpha/', kind: 'runs', id: 'r1' };

    expect([
      rowKeyOf(runTallyRows, opened, run),
      rowKeyOf(topicRows, opened, run),
      rowKeyOf(topicRows, opened, { ...run, kind: 'others' }),
    ]).toEqual(['r1', 'spring', undefined]);
  });
});

describe('the columns a reader advances', () => {
  it('are those a projection declares, set by the fold only for the types it names', () => {
    expect([advancedColumnsOf(runTallyRows), advancedColumnsOf(topicRows)]).toEqual([
      [],
      ['open', 'next_at', 'due_at'],
    ]);
    expect([
      setsAdvancedColumns(topicRows, 'topic_opened'),
      setsAdvancedColumns(topicRows, 'topic_noted'),
      setsAdvancedColumns(runTallyRows, 'run_began'),
    ]).toEqual([true, false, false]);
  });

  it('refuse a column the projection does not let its reader advance', () => {
    expect(() => {
      requireAdvancedColumns(topicRows, { open: false });
    }).not.toThrow();
    expect(() => {
      requireAdvancedColumns(runTallyRows, { open: false });
    }).toThrow('The projection run_tallies does not let its reader advance the column open');
  });
});

import { describe, expect, it } from 'vitest';

import { eventually } from '../testing/eventually.ts';
import { onSQLite } from '../testing/host-files.ts';
import { failingOnce } from '../views-testing/pool-faults.ts';
import { counting, foldedAll, liveWith, viewTestTimeoutMs } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { firstSeenOf } from './projector.ts';

const anyText: unknown = expect.any(String);

describe('the records a projector reports', { timeout: viewTestTimeoutMs }, () => {
  it('are told once each, remembering only the newest as many as it may', () => {
    const firstSeen = firstSeenOf(2);

    expect(['a', 'a', 'b', 'c', 'a', 'c'].map((record) => firstSeen(record))).toEqual([
      true,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('include a record passed over once, though a view rebuilt later reads it again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('first', counting);
    await views.ran('inference/runs', 1);
    await views.append('brain/acme/alpha/executions/broken', [
      { type: 'execution_succeeded', data: { type: 'execution_succeeded' } },
    ]);
    views.start();
    await views.until('first', liveWith(1));

    await views.saved('second', counting);
    await views.until('second', liveWith(1));

    expect(views.reports.notes()).toEqual([
      { kind: 'record_passed_over', brain: 'brain/acme/alpha/', record: anyText, reason: 'unreadable' },
    ]);
  });
});

describe('a projector that fails', { timeout: viewTestTimeoutMs }, () => {
  it('reports a sweep that failed, and sweeps again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('inference/runs', 1);
    views.failingDiscovery(true);
    views.start({ sweepEveryMs: 20 });

    const troubles = await eventually(views.reports.troubles, (reported) => reported.length > 0);
    views.failingDiscovery(false);
    const kept = await views.until('runs', foldedAll(1));

    expect(troubles[0]).toBe('A sweep of the views failed; the next sweep tries again');
    expect(kept).toMatchObject({ phase: 'live', view: 1 });
  });

  it('reports a pass of a brain that failed, and passes again', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('inference/runs', 1);
    views.start({ sweepEveryMs: 20, pool: failingOnce(views.pool).pool });

    const kept = await views.until('runs', foldedAll(1));

    expect(views.reports.troubles()).toEqual(['A pass of the views of a brain failed; the next sweep tries again']);
    expect(kept).toMatchObject({ phase: 'live', view: 1 });
  });
});

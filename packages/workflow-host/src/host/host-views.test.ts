import { setTimeout } from 'node:timers/promises';

import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { onSQLite } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { counting, viewTestTimeoutMs } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { openWorkflowStore } from './workflow-store.ts';

describe('a host given a store and the settings of views', { timeout: viewTestTimeoutMs }, () => {
  it('keeps the views of recall functions on that store while it serves, and stops keeping them when it stops', async () => {
    const settings = await onSQLite();
    const views = await viewHarness(settings);
    await views.saved('runs', counting);
    await views.ran('inference/runs', 1);
    const store = await openWorkflowStore(settings, Function.constVoid);

    const hosted = await hostedOn(store, { views: views.settingsOf() });
    const kept = await views.until('runs', ({ folded }) => folded === 1);
    await hosted.host.stop();
    await views.ran('inference/runs', 2);
    await setTimeout(300);
    const afterStopping = await views.viewOf('runs');

    expect([kept.phase, kept.view, afterStopping?.folded]).toEqual(['live', 1, 1]);
    expect(hosted.troubles()).toEqual([]);
  });
});

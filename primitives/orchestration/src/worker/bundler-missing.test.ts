import { describe, expect, it } from 'vitest';

import { registerWithoutSwc } from '../testing/without-swc.ts';
import { requireWorkflowBundler } from './workflow-bundle.ts';

registerWithoutSwc();

describe('a process without the workflow bundler', () => {
  it('cannot bundle the workflow code, and says to set ORCHESTRATION_WORKFLOW_BUNDLE', () => {
    expect(() => {
      requireWorkflowBundler();
    }).toThrow(
      'ORCHESTRATION_WORKFLOW_BUNDLE is not set, and the workflow code cannot be bundled here because the bundler swc is not installed; set ORCHESTRATION_WORKFLOW_BUNDLE to a bundle built ahead of time, /app/workflow-bundle in the image',
    );
  });
});

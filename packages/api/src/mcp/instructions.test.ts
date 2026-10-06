import { describe, expect, it } from 'vitest';

import { catalogInstructionsFor } from './instructions.ts';

const brainTools = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const specTools = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
];

const opening = 'This server runs the business brains of your org.';

const closing =
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.';

describe('catalogInstructionsFor', () => {
  it('orients an assistant to brains, specs, executions and workflows when all are served', () => {
    const instructions = catalogInstructionsFor({
      orgTools: [...brainTools, 'list_models'],
      brainTools: [...specTools, 'send_execution_event'],
    });

    expect(instructions).toBe(
      [
        opening,
        'Start with list_brains to see them, or create_brain to make one.',
        'A spec is a named, versioned definition in a brain.',
        'The primitive field selects a definition type; each tool describes its supported document formats.',
        'list_models lists the models this server can call.',
        'execute_spec runs a definition and records its run; execution_id identifies it.',
        'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
        'Workflows coordinate the work. A waiting workflow run receives input through send_execution_event.',
        "Every tool that works inside a brain takes the brain's id as brain.",
        closing,
      ].join(' '),
    );
    expect(instructions.split(' ').length).toBeLessThanOrEqual(150);
  });

  it('says nothing of workflows when they are not offered', () => {
    expect(catalogInstructionsFor({ orgTools: brainTools, brainTools: specTools })).not.toContain('workflow');
  });

  it('says nothing of the models when list_models is not offered', () => {
    expect(catalogInstructionsFor({ orgTools: brainTools, brainTools: specTools })).not.toContain('list_models');
  });

  it('says only what holds for every server when it serves nothing', () => {
    expect(catalogInstructionsFor({ orgTools: [], brainTools: [] })).toBe(`${opening} ${closing}`);
  });
});

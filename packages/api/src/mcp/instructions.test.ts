import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { internalTermsIn } from '../testing/internal-terms.ts';
import { instructionsFor, type McpEndpoint, type ServedTools } from './instructions.ts';

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

const orgEndpoint: ServedTools = { orgTools: [...brainTools, 'list_models'], brainTools: [] };

const brainEndpoint: ServedTools = { orgTools: [], brainTools: [...specTools, 'send_execution_event'] };

const ownOrg: ServedTools = { orgTools: orgEndpoint.orgTools, brainTools: brainEndpoint.brainTools };

const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['brain', brainEndpoint],
  ['own org', ownOrg],
];

const concepts = [
  'A brain belongs to an org and holds functions, with which it reasons, interacts, predicts, recalls and computes, and workflows that coordinate them.',
  'A function or a workflow is a reusable definition, and a run executes it on an input.',
  'A reasoning function has a prompt and calls a language model.',
  'Until they are renamed, the tools say spec for a definition and execution for a run, primitive inference for a reasoning function and primitive orchestration for a workflow.',
  'When you answer the person, say in a sentence or two what was done and what they can do next, in the words of brains, functions, workflows and runs, and leave ids, statuses and the rules of this server out unless they ask.',
].join(' ');

const closing =
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.';

const terminology = readFileSync(new URL('../../../../docs/concepts/terminology.md', import.meta.url), 'utf8');

function functionKindsOnTheTerminologyPage(): readonly string[] {
  const [, kinds = ''] = /^A brain (\w+(?:, (?:and )?\w+)+)\./mu.exec(terminology) ?? [];
  return kinds.split(/, (?:and )?/u);
}

describe("the instructions of /mcp, the endpoint of the caller's own org", () => {
  it('say what a brain is, then orient an agent to the brains, definitions, runs and workflows it serves', () => {
    expect(instructionsFor('own org', ownOrg)).toBe(
      [
        concepts,
        "This connection acts in the caller's own org.",
        'Start with list_brains to see them, or create_brain to make one.',
        'A spec is a named, versioned definition in a brain.',
        'The primitive field selects a definition type; each tool describes its supported document formats.',
        'list_models lists the models this server can call.',
        'execute_spec runs a definition and records its run; execution_id identifies it.',
        'It may answer with status started while the work goes on; then poll get_execution until the status changes.',
        'A waiting workflow run receives input through send_execution_event.',
        "Every tool that works inside a brain takes the brain's id as brain.",
        closing,
      ].join(' '),
    );
  });

  it('say nothing of workflows or of the models when it does not serve their tools', () => {
    const instructions = instructionsFor('own org', { orgTools: brainTools, brainTools: specTools });

    expect(instructions).not.toContain('send_execution_event');
    expect(instructions).not.toContain('list_models');
  });

  it('say only what holds for every endpoint when it serves nothing', () => {
    expect(instructionsFor('own org', { orgTools: [], brainTools: [] })).toBe(
      `${concepts} This connection acts in the caller's own org. ${closing}`,
    );
  });
});

describe('the instructions of a scoped endpoint', () => {
  it('on the endpoint of an org, name the tools of its brains and models, and none that work inside a brain', () => {
    expect(instructionsFor('org', orgEndpoint)).toBe(
      [
        concepts,
        'This connection manages the brains of one org.',
        'Start with list_brains to see them, or create_brain to make one.',
        'list_models lists the models this server can call.',
        closing,
      ].join(' '),
    );
  });

  it('on the endpoint of a brain, name the tools that work inside it, and never one it does not serve', () => {
    const instructions = instructionsFor('brain', brainEndpoint);

    expect(instructions).toContain('This connection acts inside one brain.');
    expect(instructions).toContain('then poll get_execution until the status changes.');
    expect(instructions).toContain('A waiting workflow run receives input through send_execution_event.');
    expect(
      ['create_brain', 'list_brains', 'list_models', 'takes the brain'].filter((name) => instructions.includes(name)),
    ).toEqual([]);
  });
});

describe('the instructions of every endpoint', () => {
  it.each(everyEndpoint)('stay under 1,600 characters on the %s endpoint', (endpoint, served) => {
    expect(instructionsFor(endpoint, served).length).toBeLessThan(1600);
  });

  it('use no term of the internal vocabulary but the wire names they explain, and no product name', () => {
    const instructions = instructionsFor('own org', ownOrg);

    expect(internalTermsIn(instructions)).toEqual(['spec', 'primitive', 'execution', 'inference', 'orchestration']);
    expect(instructions).not.toMatch(/\bauto\b/iu);
  });

  it('name every kind of function the terminology page names, whatever the endpoint serves', () => {
    const kinds = functionKindsOnTheTerminologyPage();
    const missing = everyEndpoint.flatMap(([endpoint]) =>
      kinds.filter((kind) => !instructionsFor(endpoint, { orgTools: [], brainTools: [] }).includes(kind)),
    );

    expect(kinds).toEqual(['reasons', 'interacts', 'predicts', 'recalls', 'computes']);
    expect(missing).toEqual([]);
  });
});

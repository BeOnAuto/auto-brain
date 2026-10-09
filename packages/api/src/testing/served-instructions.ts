import type { DefinitionType, McpEndpoint, RecipeCalls, ServedTools } from '../mcp/instructions.ts';

const managingBrains = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const insideABrain = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'get_run_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'list_interactions',
  'answer_interaction',
  'send_run_event',
  'get_guide',
];

export const queriesInsideABrain = [
  'list_definitions',
  'get_definition',
  'get_run',
  'list_runs',
  'get_run_history',
  'get_brain_analytics',
  'list_brain_events',
  'list_tool_servers',
  'list_interactions',
  'get_guide',
];

const discovering = ['list_models', 'list_tool_servers'];

export const orgEndpoint: ServedTools = { orgTools: [...managingBrains, ...discovering, 'get_guide'], brainTools: [] };

export const brainEndpoint: ServedTools = { orgTools: [], brainTools: insideABrain };

export const ownOrg: ServedTools = {
  orgTools: [...managingBrains, ...discovering],
  brainTools: insideABrain.filter((name) => !discovering.includes(name)),
};

export const definitionTypes: readonly DefinitionType[] = [
  { type: 'reasoning', noun: 'reasoning function', guide: 'reasoning-function' },
  { type: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { type: 'computation', noun: 'computation function', guide: 'computation-function' },
  { type: 'recall', noun: 'recall function', guide: 'recall-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

export const recipes: readonly RecipeCalls[] = [
  {
    name: 'first-brain',
    calls: ['list_brains', 'create_brain', 'create_definition', 'test_tool_call', 'run_definition'],
  },
  { name: 'remember', calls: ['list_definitions', 'create_definition', 'update_definition', 'run_definition'] },
  {
    name: 'give-tools',
    calls: ['list_tool_servers', 'test_tool_call', 'create_definition', 'run_definition', 'get_run_history'],
  },
  { name: 'schedule', calls: ['list_definitions', 'create_definition', 'update_definition', 'list_runs', 'get_run'] },
];

export const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['brain', brainEndpoint],
  ['own org', ownOrg],
];

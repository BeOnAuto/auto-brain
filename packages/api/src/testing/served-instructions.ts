import type { DefinitionType, McpEndpoint, RecipeCalls, ServedTools } from '../mcp/instructions.ts';

const managingBrains = ['create_brain', 'list_brains', 'get_brain', 'update_brain', 'retire_brain'];

const insideABrain = [
  'create_spec',
  'list_specs',
  'get_spec',
  'update_spec',
  'retire_spec',
  'execute_spec',
  'get_execution',
  'cancel_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'publish_event',
  'list_tool_servers',
  'test_tool_call',
  'list_interactions',
  'answer_interaction',
  'send_execution_event',
  'get_guide',
];

export const queriesInsideABrain = [
  'list_specs',
  'get_spec',
  'get_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
  'list_brain_events',
  'list_tool_servers',
  'list_interactions',
  'get_guide',
];

export const orgEndpoint: ServedTools = { orgTools: [...managingBrains, 'list_models', 'get_guide'], brainTools: [] };

export const brainEndpoint: ServedTools = { orgTools: [], brainTools: insideABrain };

export const ownOrg: ServedTools = { orgTools: [...managingBrains, 'list_models'], brainTools: insideABrain };

export const definitionTypes: readonly DefinitionType[] = [
  { primitive: 'inference', noun: 'reasoning function', guide: 'reasoning-function' },
  { primitive: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { primitive: 'computation', noun: 'computation function', guide: 'computation-function' },
  { primitive: 'recollection', noun: 'recall function', guide: 'recall-function' },
  { primitive: 'orchestration', noun: 'workflow', guide: 'workflow' },
];

export const recipes: readonly RecipeCalls[] = [
  { name: 'first-brain', calls: ['list_brains', 'create_brain', 'create_spec', 'test_tool_call', 'execute_spec'] },
  { name: 'remember', calls: ['list_specs', 'create_spec', 'update_spec', 'execute_spec'] },
  {
    name: 'give-tools',
    calls: ['list_tool_servers', 'test_tool_call', 'create_spec', 'execute_spec', 'get_execution_history'],
  },
  { name: 'schedule', calls: ['list_specs', 'create_spec', 'update_spec', 'list_executions', 'get_execution'] },
];

export const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', orgEndpoint],
  ['brain', brainEndpoint],
  ['own org', ownOrg],
];

export const orgEndpointInstructions = [
  'This MCP endpoint serves one org of auto-brain, the runtime for business brains.',
  'Its tools are the operations on the org as a whole, such as creating, listing, reading, updating and retiring its brains.',
  'Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns.',
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
].join(' ');

export const brainEndpointInstructions = [
  'This MCP endpoint serves one brain of an org in auto-brain, the runtime for business brains.',
  'Its tools are the operations inside that brain, such as defining, versioning, retiring and executing the specs of its primitives; it lists no tools when the server offers no primitive.',
  'Each tool is one operation: its description says what it does, its input schema what it takes and its output schema what it returns.',
  'A tool that cannot do what was asked returns isError with an RFC 9457 problem document as text; its reason and detail say why.',
].join(' ');

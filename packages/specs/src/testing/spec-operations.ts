import {
  defineCreateSpec,
  defineExecuteSpec,
  defineGetSpec,
  defineListSpecs,
  defineRetireSpec,
  defineUpdateSpec,
  getExecution,
  type Primitive,
} from '../index.ts';

export function specOperationsFor(primitives: readonly Primitive[]) {
  return {
    createSpec: defineCreateSpec(primitives),
    listSpecs: defineListSpecs(primitives),
    getSpec: defineGetSpec(primitives),
    updateSpec: defineUpdateSpec(primitives),
    retireSpec: defineRetireSpec(primitives),
    executeSpec: defineExecuteSpec(primitives),
    getExecution,
  };
}

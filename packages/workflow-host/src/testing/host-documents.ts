import { defaultLimits, defaultSeed } from '@beonauto/workflow-engine/testing';
import { Schema } from 'effect';
import { parse } from 'yaml';

import type { RunStart } from '../host/run-requests.ts';
import type { RunAddress } from '../runs/run-address.ts';

type JsonObject = typeof Schema.JsonObject.Type;

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

export function workflow(source: string): JsonObject {
  return { document: header, ...decodeObject(parse(source)) };
}

export function runAt(runId: string): RunAddress {
  return { org: 'acme', brain: 'alpha', runId };
}

export function startOf(document: JsonObject, input: JsonObject = {}): RunStart {
  return { document, input, limits: defaultLimits, attributes: { org: 'acme', brain: 'alpha' }, seed: defaultSeed };
}

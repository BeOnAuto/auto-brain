import { readFile } from 'node:fs/promises';

import * as releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { Schema } from 'effect';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';

import type { SandboxInstance } from '../programs/sandbox-session.ts';

interface GrowingMemory {
  readonly grow: (pages: number) => number;
}

interface MemoryLimits {
  readonly initial: number;
  readonly maximum: number;
}

type MemoryConstructor = new (limits: MemoryLimits) => GrowingMemory;

type Compile = (bytes: Readonly<Uint8Array>) => Promise<WebAssembly.Module>;

interface Bounded {
  readonly memory: GrowingMemory;
  readonly refusedGrowth: () => boolean;
}

export const pageBytes = 65_536;

const initialPages = 256;

const WebAssemblySchema = Schema.Struct({
  Memory: Schema.declare((value: unknown): value is MemoryConstructor => typeof value === 'function'),
  compile: Schema.declare((value: unknown): value is Compile => typeof value === 'function'),
});

const webAssembly = Schema.decodeUnknownSync(WebAssemblySchema)(Reflect.get(globalThis, 'WebAssembly'));

const variant = Schema.decodeUnknownSync(
  Schema.declare((value: unknown): value is QuickJSSyncVariant => Reflect.get(new Object(value), 'type') === 'sync'),
)(releaseSync.default);

const compiledModule: { pending?: Promise<WebAssembly.Module> } = {};

function compiled(): Promise<WebAssembly.Module> {
  compiledModule.pending ??= readFile(new URL(import.meta.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))).then(
    webAssembly.compile,
  );
  return compiledModule.pending;
}

function boundedMemory(memoryBytes: number): Bounded {
  const refused = { growth: false };
  const memory = new webAssembly.Memory({ initial: initialPages, maximum: Math.ceil(memoryBytes / pageBytes) });
  const grow = memory.grow.bind(memory);
  Object.defineProperty(memory, 'grow', {
    value: (pages: number): number => {
      try {
        return grow(pages);
      } catch (error) {
        refused.growth = true;
        throw error;
      }
    },
  });
  return { memory, refusedGrowth: () => refused.growth };
}

export async function freshInstance(memoryBytes: number): Promise<SandboxInstance> {
  const { memory, refusedGrowth } = boundedMemory(memoryBytes);
  const wasmModule = await compiled();
  const module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule, wasmMemory: memory }));
  return { module, memoryBytes, refusedGrowth };
}

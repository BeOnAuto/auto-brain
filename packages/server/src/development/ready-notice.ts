import { configurationOf, type Environment } from '@beonauto/config';
import { providerStatus, readModelSettings } from '@beonauto/inference';
import { Effect, Function, Result } from 'effect';

import { fileSettings } from '../config-file/file-settings.ts';

const noModelYet = 'none configured; copy .env.example to .env and put a key in it';

function modelsIn(settings: Environment): string {
  const { environment } = Result.getOrElse(
    configurationOf(settings, fileSettings),
    Function.constant({ environment: settings, file: undefined }),
  );
  const { configured } = providerStatus(Effect.runSync(readModelSettings(environment)), { entraId: false });
  return configured.length === 0 ? noModelYet : configured.join(', ');
}

export function readyNotice(port: number, settings: Environment): string {
  return [
    'auto-brain is ready',
    `  server     http://localhost:${port}`,
    `  models     ${modelsIn(settings)}`,
    `  MCP        http://localhost:${port}/mcp`,
  ].join('\n');
}

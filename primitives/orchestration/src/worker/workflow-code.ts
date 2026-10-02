import { fileURLToPath } from 'node:url';

export const workflowsPath = fileURLToPath(new URL('../workflow/workflows.ts', import.meta.url));

export const failureConverterPath = fileURLToPath(new URL('failure-converter.ts', import.meta.url));

export const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));

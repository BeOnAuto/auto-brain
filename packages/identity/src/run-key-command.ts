import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

import { allPermissions } from '@beonauto/operations';
import { Result, Schema } from 'effect';

import { KeyGrantSchema, createApiKey, type KeyGrant } from './api-key.ts';
import { describeIssues, failureOf } from './issues.ts';

export interface Terminal {
  readonly print: (line: string) => void;
  readonly complain: (line: string) => void;
}

interface KeyOptions {
  readonly org?: string | undefined;
  readonly id?: string | undefined;
  readonly permissions?: string | undefined;
  readonly brains?: string | undefined;
}

const usage =
  'Arguments: --org <org id> [--id <key id>] [--permissions <comma-separated permissions>] [--brains <comma-separated brain ids, or *>]';

const decodeGrant = Schema.decodeUnknownResult(KeyGrantSchema, { onExcessProperty: 'error', errors: 'all' });

function optionsFrom(args: readonly string[]): KeyOptions | string {
  try {
    return parseArgs({
      args: args[0] === '--' ? args.slice(1) : [...args],
      options: {
        org: { type: 'string' },
        id: { type: 'string' },
        permissions: { type: 'string' },
        brains: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    return String(error);
  }
}

function asOption(keys: readonly PropertyKey[]): string {
  return `--${keys.slice(0, 1).map(String).join('')}`;
}

function brainsFrom(brains: string | undefined): readonly string[] | '*' {
  return brains === undefined || brains === '*' ? '*' : brains.split(',');
}

function grantFrom(args: readonly string[]): KeyGrant | string {
  const options = optionsFrom(args);
  if (typeof options === 'string') {
    return options;
  }
  const decoded = decodeGrant({
    id: options.id ?? randomBytes(4).toString('hex'),
    ...(options.org === undefined ? {} : { org: options.org }),
    permissions: options.permissions?.split(',') ?? allPermissions,
    brains: brainsFrom(options.brains),
  });
  return Result.isSuccess(decoded) ? decoded.success : describeIssues(failureOf(decoded.failure.issue), asOption);
}

export function runKeyCommand(args: readonly string[], terminal: Terminal): number {
  const grant = grantFrom(args);
  if (typeof grant === 'string') {
    terminal.complain(grant);
    terminal.complain(usage);
    return 1;
  }
  const { key, entry } = createApiKey(grant);
  terminal.print(`API key, shown only this once: ${key}`);
  terminal.print(`API_KEYS entry: ${JSON.stringify(entry)}`);
  return 0;
}

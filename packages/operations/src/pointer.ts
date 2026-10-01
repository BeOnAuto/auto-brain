import { JsonPointer, type StandardSchema } from 'effect';

type IssuePath = StandardSchema.StandardSchemaV1.Issue['path'];

export function pointerOf(path: IssuePath): string {
  return (path ?? [])
    .map((segment) => `/${JsonPointer.escapeToken(String(typeof segment === 'object' ? segment.key : segment))}`)
    .join('');
}

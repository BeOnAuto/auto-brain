import type { ModelTools } from '../model/model-request.ts';
import type { ModelWarning } from '../model/model-result.ts';
import { notPortableAsToolInput } from '../schema/answer-schema.ts';

export function inputSchemaWarnings(tools: ModelTools | undefined, provider: string): readonly ModelWarning[] {
  return (tools?.offered ?? []).flatMap(({ name, inputSchema }) =>
    notPortableAsToolInput(inputSchema)
      .filter(({ providers }) => providers.includes(provider))
      .map(({ pointer, detail }): ModelWarning => ({
        type: 'compatibility',
        feature: `${name} inputSchema#${pointer}`,
        detail,
      })),
  );
}

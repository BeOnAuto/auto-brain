import { describe, expect, it } from 'vitest';

import { catalogFor, idsIn } from '../testing/catalog-harness.ts';
import { openAiModels } from '../testing/model-lists.ts';
import { jsonResponse } from '../testing/recording-fetch.ts';

describe('the models of openai', () => {
  it('are read with the key, keeping only those a conversation can use by their documented names', async () => {
    const catalog = await catalogFor({ OPENAI_API_KEY: 'sk-openai-key' }, () => jsonResponse(openAiModels));

    const list = await catalog.list();

    expect(catalog.requests()).toMatchObject([
      { url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer sk-openai-key' } },
    ]);
    expect(idsIn(list)).toEqual(['openai/gpt-4.1', 'openai/gpt-5', 'openai/gpt-5-mini', 'openai/o3']);
    expect(list.data[1]).toEqual({ id: 'openai/gpt-5', object: 'model', created: 1_754_425_777, owned_by: 'openai' });
  });

  it('are read from the base URL that is set', async () => {
    const catalog = await catalogFor(
      { OPENAI_API_KEY: 'sk-openai-key', OPENAI_BASE_URL: 'https://llm.example.com/openai/v1' },
      () => jsonResponse({ object: 'list', data: [{ id: 'gpt-5', object: 'model', owned_by: 'system' }] }),
    );

    const list = await catalog.list();

    expect(catalog.requests()[0]?.url).toBe('https://llm.example.com/openai/v1/models');
    expect(list.data).toEqual([{ id: 'openai/gpt-5', object: 'model', created: 0, owned_by: 'openai' }]);
  });
});

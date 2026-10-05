import type { StoredData } from '../emmett/emmett-event-store.ts';

type JsonText = { readonly json: string };

function parsed(json: string): unknown {
  return JSON.parse(json);
}

export const dataAsJsonText: StoredData<JsonText> = {
  stored: (data) => ({ json: JSON.stringify(data) }),
  read: ({ json }) => parsed(json),
};

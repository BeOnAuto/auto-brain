import { Option } from 'effect';

export interface ModelReference {
  readonly provider: string;
  readonly model: string;
}

const separator = '/';

export function parseModelReference(reference: string): Option.Option<ModelReference> {
  const split = reference.indexOf(separator);
  if (split < 1 || split === reference.length - 1) {
    return Option.none();
  }
  return Option.some({ provider: reference.slice(0, split), model: reference.slice(split + 1) });
}

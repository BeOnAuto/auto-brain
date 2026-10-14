export const studioOrigin = 'https://studio.on.auto';

export function pageOriginsOf(allowedOrigins: readonly string[]): readonly string[] {
  return [studioOrigin, ...allowedOrigins];
}

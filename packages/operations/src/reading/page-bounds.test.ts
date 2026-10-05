import { describe, expect, it } from 'vitest';

import { boundedPage, mostBytesLoadedInAPage, type Examined } from '../index.ts';

const mebibyte = 1024 * 1024;

function examined(...items: readonly (readonly [wanted: boolean, size: number])[]): readonly Examined[] {
  return items.map(([wanted, size], index) => ({ examined: index + 1, wanted, size }));
}

const wantedOnes = examined([true, 1], [true, 1], [true, 1], [true, 1]);

describe('a page bounded by what the store examines', () => {
  it('delivers the wanted items up to its limit, and resumes after the last one it examined', () => {
    const { delivered, resumeAfter } = boundedPage(wantedOnes, 3, 3);

    expect({ delivered, resumeAfter }).toEqual({ delivered: wantedOnes.slice(0, 3), resumeAfter: wantedOnes[2] });
  });

  it('has nothing to resume after once it examined all there is', () => {
    expect(boundedPage(wantedOnes.slice(0, 2), 3, 3)).toEqual({
      delivered: wantedOnes.slice(0, 2),
      resumeAfter: undefined,
    });
  });

  it('passes over what it does not want, and resumes after it even when it delivers nothing', () => {
    const unwanted = examined([false, 0], [false, 0], [false, 0], [true, 1]);

    expect(boundedPage(unwanted, 3, 3)).toEqual({ delivered: [], resumeAfter: unwanted[2] });
  });

  it('stops before the item that would load more than 4 MiB, but always delivers the first it wants', () => {
    const large = examined([false, 0], [true, 1.5 * mebibyte], [true, 1.5 * mebibyte], [true, 1.5 * mebibyte]);
    const huge = examined([true, 2 * mostBytesLoadedInAPage], [true, 1]);

    expect(boundedPage(large, 20, 20)).toEqual({ delivered: large.slice(1, 3), resumeAfter: large[2] });
    expect(boundedPage(huge, 20, 20)).toEqual({ delivered: huge.slice(0, 1), resumeAfter: huge[0] });
  });

  it('examines no more than it may, and resumes after the last item it was allowed to examine', () => {
    const rare = examined([false, 0], [true, 1], [false, 0], [true, 1]);

    expect(boundedPage(rare, 20, 3)).toEqual({ delivered: rare.slice(1, 2), resumeAfter: rare[2] });
  });
});

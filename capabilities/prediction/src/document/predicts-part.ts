import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { checkedFrom, isWhole, nameIssues, refusedAt, type Checked } from './checked-parts.ts';
import type { WrittenPredicts } from './front-matter.ts';
import type { Predicts } from './prediction-document.ts';

const { mostHorizons, mostHorizon, leastSeason, mostSeason, mostUnitCharacters } = predictionBounds;

function seasonIssues(season: number | undefined, lines: SourceLines): readonly DocumentIssue[] {
  return season === undefined || isWhole(season, leastSeason, mostSeason)
    ? []
    : refusedAt(
        lines,
        '/predicts/season',
        `A season is a whole number of periods from ${leastSeason} to ${mostSeason}, not ${season}; leave it out when the series has none`,
      );
}

function horizonIssues(horizons: readonly number[], lines: SourceLines): readonly DocumentIssue[] {
  if (horizons.length === 0 || horizons.length > mostHorizons) {
    return refusedAt(
      lines,
      '/predicts/horizons',
      `A prediction function names 1 to ${mostHorizons} horizons; it names ${horizons.length}`,
    );
  }
  return horizons.flatMap((horizon, index) => {
    const pointer = `/predicts/horizons/${index}`;
    if (!isWhole(horizon, 1, mostHorizon)) {
      return refusedAt(
        lines,
        pointer,
        `A horizon is a whole number of periods from 1 to ${mostHorizon}, not ${horizon}`,
      );
    }
    return horizons.indexOf(horizon) < index
      ? refusedAt(lines, pointer, `The horizon ${horizon} is named more than once; name each horizon once`)
      : [];
  });
}

function unitIssues(unit: string, lines: SourceLines): readonly DocumentIssue[] {
  return unit.trim() === '' || unit.length > mostUnitCharacters
    ? refusedAt(lines, '/predicts/unit', `The unit is text of 1 to ${mostUnitCharacters} characters, such as orders`)
    : [];
}

export function predictsOf(written: WrittenPredicts, lines: SourceLines): Checked<Predicts> {
  const { target, period, season, horizons, unit } = written;
  const issues = [
    ...nameIssues(target, lines, '/predicts/target'),
    ...seasonIssues(season, lines),
    ...horizonIssues(horizons, lines),
    ...unitIssues(unit, lines),
  ];
  return checkedFrom(issues, () => ({
    target,
    period,
    ...(season === undefined ? {} : { season }),
    horizons,
    unit: unit.trim(),
  }));
}

export function longestHorizonOf({ horizons }: Predicts): number {
  return Math.max(...horizons);
}

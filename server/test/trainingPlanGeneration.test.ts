import { describe, expect, it } from 'vitest';
import { computeEndDate } from '../src/routes/trainingPlanGeneration.js';

describe('computeEndDate', () => {
  it('spans exactly durationWeeks weeks for a general-fitness goal (inclusive of startDate)', () => {
    // A 1-week plan starting Monday should end the following Sunday (7 days total), not the Monday after.
    expect(computeEndDate({ isRace: false, startDate: '2026-01-05', durationWeeks: 1 })).toBe('2026-01-11');
    expect(computeEndDate({ isRace: false, startDate: '2026-01-05', durationWeeks: 8 })).toBe('2026-03-01');
  });

  it('uses the race date exactly, ignoring durationWeeks, when isRace', () => {
    expect(computeEndDate({ isRace: true, startDate: '2026-01-01', raceDate: '2026-03-01' })).toBe('2026-03-01');
  });
});

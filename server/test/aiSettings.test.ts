import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import { getAiSettings, updateAiSettings } from '../src/repositories/aiSettings.js';

function db() {
  return openEventsDb(':memory:');
}

describe('ai settings repository', () => {
  it('seeds defaults on a fresh database', () => {
    const settings = getAiSettings(db());
    expect(settings.question.models).toEqual([
      'deepseek/deepseek-v4-flash',
      'google/gemini-3.5-flash',
      'deepseek/deepseek-v4-pro',
    ]);
    expect(settings.question.selected).toBe('deepseek/deepseek-v4-flash');
    expect(settings.plan.models).toEqual(settings.question.models);
    expect(settings.plan.selected).toBe('deepseek/deepseek-v4-flash');
    expect(settings.analysis.models).toEqual(settings.question.models);
    expect(settings.analysis.selected).toBe('deepseek/deepseek-v4-flash');
  });

  it('persists an update and round-trips it', () => {
    const d = db();
    const updated = updateAiSettings(d, {
      question: { models: ['a/1', 'b/2', 'c/3'], selected: 'b/2' },
      plan: { models: ['x/1', 'y/2', 'z/3'], selected: 'z/3' },
      analysis: { models: ['m/1', 'n/2', 'o/3'], selected: 'm/1' },
    });
    expect(updated.question).toEqual({ models: ['a/1', 'b/2', 'c/3'], selected: 'b/2' });
    expect(updated.plan).toEqual({ models: ['x/1', 'y/2', 'z/3'], selected: 'z/3' });
    expect(updated.analysis).toEqual({ models: ['m/1', 'n/2', 'o/3'], selected: 'm/1' });
    expect(getAiSettings(d)).toEqual(updated);
  });
});

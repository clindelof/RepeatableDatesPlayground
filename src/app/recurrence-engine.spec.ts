import { PlaygroundConfig, generate, pythonExample, serializeSchedule } from './recurrence-engine';

const base = (overrides: Partial<PlaygroundConfig> = {}): PlaygroundConfig => ({
  name: 'Test', kind: 'weekly', start: '2026-01-01', rangeStart: '2026-01-01', rangeEnd: '2026-02-01',
  every: 1, weekdays: [0], monthDays: [31], months: [1], ordinalWeekday: 0, ordinal: 1,
  overflow: 'clamp', until: '', count: null, adjustment: 'none', collision: 'keep', weekend: [5, 6],
  holidays: [], include: [], exclude: [], ...overrides,
});

describe('recurrence engine', () => {
  it('generates weekly dates using Python weekday numbering', () => {
    expect(generate(base()).occurrences.map((item) => item.date)).toEqual([
      '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26',
    ]);
  });

  it('clamps month-end dates and can skip them', () => {
    const clamp = base({ kind: 'monthly', rangeEnd: '2026-04-01' });
    expect(generate(clamp).occurrences.map((item) => item.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(generate({ ...clamp, overflow: 'skip' }).occurrences.map((item) => item.date)).toEqual(['2026-01-31', '2026-03-31']);
  });

  it('adjusts holidays and resolves collisions', () => {
    const result = generate(base({
      kind: 'weekly', weekdays: [5, 6], rangeEnd: '2026-01-12', adjustment: 'previous_weekday', collision: 'deduplicate',
    }));
    expect(result.occurrences.map((item) => item.date)).toEqual(['2026-01-02', '2026-01-09']);
    expect(result.collisionCount).toBe(2);
  });

  it('applies occurrence limits from the schedule start', () => {
    const result = generate(base({ weekdays: [0, 4], count: 3, rangeStart: '2026-01-06' }));
    expect(result.occurrences.map((item) => item.date)).toEqual(['2026-01-09']);
  });

  it('serializes schedules and generates library-aligned Python', () => {
    const config = base({ kind: 'monthly_weekday', ordinalWeekday: 4, ordinal: -1 });
    expect(serializeSchedule(config)).toEqual({ type: 'monthly_weekday', start: '2026-01-01', weekday: 4, occurrence: -1 });
    expect(pythonExample(config)).toContain('Schedule.monthly_weekday');
    expect(pythonExample(config)).toContain('weekday=Weekday.FRIDAY');
  });
});

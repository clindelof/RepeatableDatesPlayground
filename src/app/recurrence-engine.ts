export type RuleKind = 'once' | 'weekly' | 'monthly' | 'monthly_weekday' | 'yearly';
export type Adjustment = 'none' | 'previous_weekday' | 'next_weekday' | 'nearest_weekday';
export type Collision = 'keep' | 'deduplicate' | 'error';
export type Overflow = 'clamp' | 'skip';

export interface PlaygroundConfig {
  name: string;
  kind: RuleKind;
  start: string;
  rangeStart: string;
  rangeEnd: string;
  every: number;
  weekdays: number[];
  monthDays: number[];
  months: number[];
  ordinalWeekday: number;
  ordinal: number;
  overflow: Overflow;
  until: string;
  count: number | null;
  adjustment: Adjustment;
  collision: Collision;
  weekend: number[];
  holidays: string[];
  include: string[];
  exclude: string[];
}

export interface Occurrence {
  original: string;
  date: string;
  source: 'rule' | 'included';
  adjustment: string;
  collision: boolean;
}

export interface GenerationResult {
  occurrences: Occurrence[];
  error: string | null;
  rawCount: number;
  excludedCount: number;
  collisionCount: number;
}

const DAY_MS = 86_400_000;

export function parseIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? result
    : null;
}

export function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getTime() + amount * DAY_MS);
}

function pythonWeekday(value: Date): number {
  return (value.getUTCDay() + 6) % 7;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthIndex(value: Date): number {
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function rawOccurrences(config: PlaygroundConfig, queryStart: Date, queryEnd: Date): Date[] {
  const anchor = parseIso(config.start);
  if (!anchor) return [];
  const until = parseIso(config.until);
  const candidates: Date[] = [];
  const hardEnd = until && until < queryEnd ? addDays(until, 1) : queryEnd;
  const start = config.count ? anchor : anchor > queryStart ? anchor : queryStart;
  const every = Math.max(1, Math.trunc(config.every || 1));

  if (config.kind === 'once') {
    if (anchor >= queryStart && anchor < hardEnd) candidates.push(anchor);
  } else if (config.kind === 'weekly') {
    const selected = new Set(config.weekdays);
    const weekAnchor = addDays(anchor, -pythonWeekday(anchor));
    for (let cursor = start; cursor < hardEnd; cursor = addDays(cursor, 1)) {
      const weeks = Math.floor((cursor.getTime() - weekAnchor.getTime()) / (7 * DAY_MS));
      if (weeks >= 0 && weeks % every === 0 && selected.has(pythonWeekday(cursor))) candidates.push(cursor);
    }
  } else if (config.kind === 'monthly' || config.kind === 'monthly_weekday') {
    const firstMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    for (let offset = 0; ; offset += 1) {
      const cursor = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + offset, 1));
      if (cursor >= hardEnd) break;
      if (offset % every !== 0) continue;
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();
      if (config.kind === 'monthly') {
        const last = daysInMonth(year, month);
        const actualDays = uniqueSorted(config.monthDays)
          .filter((day) => day >= 1 && day <= 31)
          .map((day) => day > last ? (config.overflow === 'skip' ? null : last) : day)
          .filter((day): day is number => day !== null);
        for (const day of uniqueSorted(actualDays)) candidates.push(new Date(Date.UTC(year, month, day)));
      } else {
        const wanted = config.ordinalWeekday;
        const last = daysInMonth(year, month);
        let day: number;
        if (config.ordinal === -1) {
          const lastDate = new Date(Date.UTC(year, month, last));
          day = last - ((pythonWeekday(lastDate) - wanted + 7) % 7);
        } else {
          const first = new Date(Date.UTC(year, month, 1));
          day = 1 + ((wanted - pythonWeekday(first) + 7) % 7) + 7 * (config.ordinal - 1);
        }
        if (day <= last) candidates.push(new Date(Date.UTC(year, month, day)));
      }
    }
  } else {
    const selectedMonths = uniqueSorted(config.months);
    const selectedDays = uniqueSorted(config.monthDays);
    for (let year = anchor.getUTCFullYear(); year <= hardEnd.getUTCFullYear(); year += 1) {
      if ((year - anchor.getUTCFullYear()) % every !== 0) continue;
      for (const monthNumber of selectedMonths) {
        if (monthNumber < 1 || monthNumber > 12) continue;
        const month = monthNumber - 1;
        const last = daysInMonth(year, month);
        const actualDays = selectedDays
          .map((day) => day > last ? (config.overflow === 'skip' ? null : last) : day)
          .filter((day): day is number => day !== null && day >= 1);
        for (const day of uniqueSorted(actualDays)) candidates.push(new Date(Date.UTC(year, month, day)));
      }
    }
  }

  const fromAnchor = candidates.filter((value) => value >= anchor);
  const limited = config.count ? fromAnchor.sort((a, b) => +a - +b).slice(0, config.count) : fromAnchor;
  return limited.filter((value) => value >= queryStart && value < hardEnd);
}

function isBusinessDay(value: Date, config: PlaygroundConfig): boolean {
  return !config.weekend.includes(pythonWeekday(value)) && !config.holidays.includes(iso(value));
}

function seek(value: Date, direction: -1 | 1, config: PlaygroundConfig): Date {
  let cursor = value;
  do cursor = addDays(cursor, direction); while (!isBusinessDay(cursor, config));
  return cursor;
}

function adjust(value: Date, config: PlaygroundConfig): Date {
  if (config.adjustment === 'none' || isBusinessDay(value, config)) return value;
  if (config.adjustment === 'previous_weekday') return seek(value, -1, config);
  if (config.adjustment === 'next_weekday') return seek(value, 1, config);
  for (let distance = 1; distance < 370; distance += 1) {
    const previous = addDays(value, -distance);
    if (isBusinessDay(previous, config)) return previous;
    const next = addDays(value, distance);
    if (isBusinessDay(next, config)) return next;
  }
  return value;
}

export function generate(config: PlaygroundConfig): GenerationResult {
  const rangeStart = parseIso(config.rangeStart);
  const rangeEnd = parseIso(config.rangeEnd);
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) {
    return { occurrences: [], error: 'Choose a valid range whose end is later than its start.', rawCount: 0, excludedCount: 0, collisionCount: 0 };
  }
  if (config.weekend.length === 7) {
    return { occurrences: [], error: 'At least one weekday must remain a business day.', rawCount: 0, excludedCount: 0, collisionCount: 0 };
  }

  const padding = config.holidays.length + config.weekend.length + 7;
  const rawStart = config.adjustment === 'none' ? rangeStart : addDays(rangeStart, -padding);
  const rawEnd = config.adjustment === 'none' ? rangeEnd : addDays(rangeEnd, padding);
  const raw = rawOccurrences(config, rawStart, rawEnd);
  const excluded = new Set(config.exclude);
  let excludedCount = 0;
  const adjusted: Occurrence[] = raw
    .map((original) => ({ original, final: adjust(original, config) }))
    .filter(({ final }) => final >= rangeStart && final < rangeEnd)
    .filter(({ final }) => {
      if (excluded.has(iso(final))) { excludedCount += 1; return false; }
      return true;
    })
    .map(({ original, final }) => ({
      original: iso(original),
      date: iso(final),
      source: 'rule' as const,
      adjustment: +original === +final ? 'No adjustment' : `${iso(original)} → ${iso(final)}`,
      collision: false,
    }));

  for (const value of uniqueSortedDates(config.include)) {
    const parsed = parseIso(value);
    if (parsed && parsed >= rangeStart && parsed < rangeEnd && !excluded.has(value)) {
      adjusted.push({ original: value, date: value, source: 'included', adjustment: 'Explicit inclusion', collision: false });
    }
  }
  adjusted.sort((a, b) => a.date.localeCompare(b.date));
  let collisionCount = 0;
  const result: Occurrence[] = [];
  for (const item of adjusted) {
    const duplicate = result.at(-1)?.date === item.date;
    if (duplicate) {
      collisionCount += 1;
      result[result.length - 1].collision = true;
      item.collision = true;
      if (config.collision === 'error') {
        return { occurrences: result, error: `Multiple occurrences resolve to ${item.date}.`, rawCount: raw.length, excludedCount, collisionCount };
      }
      if (config.collision === 'deduplicate') continue;
    }
    result.push(item);
  }
  return { occurrences: result, error: null, rawCount: raw.length, excludedCount, collisionCount };
}

function uniqueSortedDates(values: string[]): string[] {
  return [...new Set(values.filter((value) => parseIso(value)))].sort();
}

export function serializeSchedule(config: PlaygroundConfig): Record<string, unknown> {
  const value: Record<string, unknown> = { type: config.kind, start: config.start };
  if (config.kind === 'weekly') value['weekdays'] = uniqueSorted(config.weekdays);
  if (config.kind === 'monthly' || config.kind === 'yearly') {
    value['days'] = uniqueSorted(config.monthDays);
    value['overflow'] = config.overflow;
  }
  if (config.kind === 'monthly_weekday') {
    value['weekday'] = config.ordinalWeekday;
    value['occurrence'] = config.ordinal;
  }
  if (config.kind === 'yearly') value['months'] = uniqueSorted(config.months);
  if (config.kind !== 'once' && config.every !== 1) value['every'] = config.every;
  if (config.until) value['until'] = config.until;
  if (config.count) value['count'] = config.count;
  return value;
}

export function pythonExample(config: PlaygroundConfig): string {
  const enumName = (value: string) => value.toUpperCase();
  const imports = ['Schedule'];
  if (config.kind === 'weekly' || config.kind === 'monthly_weekday') imports.push('Weekday');
  if ((config.kind === 'monthly' || config.kind === 'yearly') && config.overflow === 'skip') imports.push('Overflow');
  if (config.adjustment !== 'none') imports.push('Adjustment', 'BusinessCalendar');
  if (config.collision !== 'keep') imports.push('Collision');
  const lines = [`from repeatable_dates import ${[...new Set(imports)].join(', ')}`, ''];
  const common: string[] = [`start="${config.start}"`];
  if (config.every !== 1) common.push(`every=${config.every}`);
  if (config.until) common.push(`until="${config.until}"`);
  if (config.count) common.push(`count=${config.count}`);
  if (config.kind === 'once') lines.push(`schedule = Schedule.once("${config.start}")`);
  if (config.kind === 'weekly') {
    const days = config.weekdays.map((day) => `Weekday.${['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'][day]}`);
    lines.push('schedule = Schedule.weekly(', `    ${common.join(',\n    ')},`, `    weekdays=[${days.join(', ')}],`, ')');
  }
  if (config.kind === 'monthly') {
    const args = [...common, `days=${JSON.stringify(uniqueSorted(config.monthDays))}`];
    if (config.overflow === 'skip') args.push('overflow=Overflow.SKIP');
    lines.push('schedule = Schedule.monthly(', ...args.map((arg) => `    ${arg},`), ')');
  }
  if (config.kind === 'monthly_weekday') {
    lines.push('schedule = Schedule.monthly_weekday(', ...common.map((arg) => `    ${arg},`), `    weekday=Weekday.${['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'][config.ordinalWeekday]},`, `    occurrence=${config.ordinal},`, ')');
  }
  if (config.kind === 'yearly') {
    const args = [...common, `months=${JSON.stringify(uniqueSorted(config.months))}`, `days=${JSON.stringify(uniqueSorted(config.monthDays))}`];
    if (config.overflow === 'skip') args.push('overflow=Overflow.SKIP');
    lines.push('schedule = Schedule.yearly(', ...args.map((arg) => `    ${arg},`), ')');
  }
  lines.push('');
  if (config.adjustment !== 'none') {
    lines.push(`calendar = BusinessCalendar(`, `    holidays=${JSON.stringify(config.holidays)},`, `    weekend=${JSON.stringify(uniqueSorted(config.weekend))},`, ')', '');
  }
  const options: string[] = [];
  if (config.adjustment !== 'none') options.push(`adjustment=Adjustment.${enumName(config.adjustment)}`, 'calendar=calendar');
  if (config.collision !== 'keep') options.push(`collisions=Collision.${enumName(config.collision)}`);
  if (config.include.length) options.push(`include=${JSON.stringify(config.include)}`);
  if (config.exclude.length) options.push(`exclude=${JSON.stringify(config.exclude)}`);
  lines.push('dates = schedule.between(', `    "${config.rangeStart}",`, `    "${config.rangeEnd}",`, ...options.map((arg) => `    ${arg},`), ')');
  return lines.join('\n');
}
